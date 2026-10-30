"""模板工坊 Web 路由 — 全部挂在 /api/ext/tpl-studio/ 下"""

from __future__ import annotations

import asyncio
from pathlib import Path

from aiohttp import web
from core.base.logger import PLUGIN, get_logger
from core.plugin.web_pages import register_route, unregister_route

from ..services import validate
from ..services import store

log = get_logger(PLUGIN, '模板工坊')

PREFIX = '/api/ext/tpl-studio'
_WEB_DIR = Path(__file__).resolve().parent.parent / 'assets'
_ASSETS = {
    'panel.css': 'text/css; charset=utf-8',
    'panel.js': 'text/javascript; charset=utf-8',
    'message-markdown.css': 'text/css; charset=utf-8',
    'message-markdown.js': 'text/javascript; charset=utf-8',
    'preview.css': 'text/css; charset=utf-8',
}


def register_routes():
    for method, path, handler, auth in _routes():
        register_route(method, path, handler, auth=auth)
    log.info('模板工坊路由已注册: %s/*', PREFIX)


def unregister_routes():
    for method, path, _handler, _auth in _routes():
        unregister_route(method, path)


def _routes():
    items = [
        ('GET', 'meta', _meta, True),
        ('GET', 'templates', _list_templates, True),
        ('GET', 'template', _get_template, True),
        ('POST', 'template', _save_template, True),
        ('DELETE', 'template', _delete_template, True),
        ('POST', 'build', _build, True),
        ('POST', 'send', _send, True),
        ('GET', 'bots', _bots, True),
        ('GET', 'groups', _groups, True),
        ('POST', 'import', _import, True),
        ('GET', 'export', _export, True),
    ]
    items.extend(('GET', f'assets/{name}', _asset, False) for name in _ASSETS)
    return [(m, f'{PREFIX}/{p}', h, a) for m, p, h, a in items]


# ---------------------------------------------------------------- 工具


async def _json(request: web.Request) -> dict:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return body if isinstance(body, dict) else {}


def _ok(data=None):
    return web.json_response({'success': True, 'data': data})


def _fail(message, *, status=400, code='INVALID_REQUEST'):
    return web.json_response(
        {'success': False, 'error': {'code': code, 'message': str(message)}}, status=status
    )


def _app():
    from core.application import get_app

    return get_app()


def _first_bot() -> tuple[str, object]:
    app = _app()
    bots = getattr(app, '_bots', {}) if app else {}
    for appid, bot in (bots or {}).items():
        return str(appid), bot
    return '', None


def _platform_keyboard_of(bot, buttons):
    """取某个机器人 appid 下真实发送的 keyboard"""
    appid = str(getattr(bot, '_appid', '') or '')
    built = validate.build({'content': '', 'buttons': buttons}, appid=appid)
    return built.get('platform_keyboard')


# ---------------------------------------------------------------- 处理器


async def _meta(_request):
    appid, bot = _first_bot()
    return _ok(
        {
            'fields': validate.field_reference(),
            'variables': validate.framework_variables(),
            'markdown': validate.markdown_reference(),
            'platform_notes': validate.platform_notes(),
            'button_types': [{'value': k, 'label': v} for k, v in sorted(validate.BUTTON_TYPES.items())],
            'button_styles': [{'value': k, 'label': v} for k, v in sorted(validate.BUTTON_STYLES.items())],
            'msg_types': [{'value': k, 'label': v} for k, v in sorted(validate.MSG_TYPES.items())],
            'font_sizes': [{'value': k, 'label': v} for k, v in validate.FONT_SIZES.items()],
            'storage': 'tpl_studio/data/templates.json',
            'default_bot': {'appid': appid, 'name': str(getattr(bot, 'name', '') or '')} if bot else None,
        }
    )


async def _list_templates(_request):
    return _ok({'templates': store.list_templates(), 'count': len(store.list_templates())})


async def _get_template(request):
    key = str(request.query.get('key') or '').strip()
    if not key:
        return _fail('缺少 key')
    template = store.get_template(key)
    if template is None:
        return _fail(f'模板 {key} 不存在', status=404, code='NOT_FOUND')
    return _ok({'key': key, 'template': template})


async def _save_template(request):
    body = await _json(request)
    key = str(body.get('key') or '').strip()
    template = body.get('template')
    if not key:
        return _fail('模板键不能为空')
    if not isinstance(template, dict):
        return _fail('template 必须是对象')
    label = str(body.get('label') or template.get('label') or key)
    category = str(body.get('category') or template.get('category') or '')
    try:
        record = await asyncio.to_thread(store.save_template, key, template, label=label, category=category)
    except Exception as e:  # noqa: BLE001
        log.error('保存模板失败: %s', e)
        return _fail(f'保存失败: {e}', status=500)
    # 回带框架真实键盘，让面板显示最终发送结构
    _appid, bot = _first_bot()
    platform = _platform_keyboard_of(bot, record.get('buttons')) if bot else None
    return _ok({'key': key, 'template': record, 'platform_keyboard': platform})


async def _delete_template(request):
    key = str(request.query.get('key') or '').strip()
    if not key:
        return _fail('缺少 key')
    removed = await asyncio.to_thread(store.delete_template, key)
    if not removed:
        return _fail(f'模板 {key} 不存在', status=404, code='NOT_FOUND')
    return _ok({'key': key, 'deleted': True})


async def _build(request):
    body = await _json(request)
    _appid, bot = _first_bot()
    appid = str(getattr(bot, '_appid', '') or '') if bot else ''
    result = await asyncio.to_thread(validate.build, body, appid=appid or str(body.get('appid') or ''))
    return _ok(result)


async def _import(request):
    body = await _json(request)
    payload = body.get('templates') if 'templates' in body else body
    if not isinstance(payload, (dict, list)):
        return _fail('导入内容必须是对象或数组')
    result = await asyncio.to_thread(store.import_templates, payload)
    return _ok(result)


async def _export(request):
    data = await asyncio.to_thread(store.all_templates)
    fmt = str(request.query.get('format') or 'plugin')
    if fmt == 'templates-yaml':
        # 框架 config/templates.yaml 直接可用的结构
        out = {}
        for key, item in data.items():
            out[key] = {'content': item.get('content', '')}
            if item.get('buttons'):
                out[key]['buttons'] = item['buttons']
        return _ok({'format': fmt, 'templates': out})
    return _ok({'format': 'plugin', 'version': 1, 'templates': data})


async def _bots(_request):
    app = _app()
    bots = getattr(app, '_bots', {}) if app else {}
    items = []
    for appid, bot in (bots or {}).items():
        items.append(
            {
                'appid': str(appid),
                'name': str(getattr(bot, 'name', '') or appid),
                'robot_qq': str(getattr(bot, 'robot_qq', '') or ''),
                'avatar': str(getattr(bot, 'avatar_url', '') or ''),
            }
        )
    return _ok({'bots': items})


async def _groups(request):
    """可发送的群列表（来自框架日志库 groups_users）"""
    app = _app()
    bot = _first_bot()[1]
    groups = []
    if bot is not None:
        logsvc = getattr(bot, 'log_service', None)
        if logsvc is not None:
            try:
                rows = await asyncio.to_thread(
                    logsvc.query_data,
                    'SELECT group_id, group_name, group_member_num, in_group, is_admin, '
                    'allow_proactive_msg FROM groups_users '
                    "WHERE group_id != '' LIMIT 500",
                    (),
                )
                for row in rows or []:
                    groups.append(
                        {
                            'group_id': str(row['group_id']),
                            'group_name': str(row['group_name'] or ''),
                            'member_num': int(row['group_member_num'] or 0),
                            'in_group': bool(row['in_group']),
                            'is_admin': bool(row['is_admin']),
                            # 主动消息权限：没有权限群测试发送会返回 40034105
                            'can_proactive': bool(row['allow_proactive_msg']),
                        }
                    )
            except Exception as e:  # noqa: BLE001
                log.warning('读取群列表失败: %s', e)
    configured = str(request.query.get('appid') or '')
    return _ok({'groups': groups, 'appid': configured or (str(getattr(bot, '_appid', '') or '') if bot else '')})


async def _send(request):
    body = await _json(request)
    key = str(body.get('key') or '').strip()
    group_id = str(body.get('group_id') or '').strip()
    user_id = str(body.get('user_id') or '').strip()
    if not group_id and not user_id:
        return _fail('需要 group_id 或 user_id')
    if key:
        template = store.get_template(key)
        if template is None:
            return _fail(f'模板 {key} 不存在', status=404, code='NOT_FOUND')
    else:
        template = body.get('template')
        if not isinstance(template, dict):
            return _fail('缺少模板：要么给 key，要么给 template')
    _appid, bot = _first_bot()
    if bot is None or not getattr(bot, 'sender', None):
        return _fail('没有运行中的机器人', status=503, code='NO_BOT')
    sender = bot.sender
    content = str(template.get('content') or '')
    buttons = template.get('buttons') or None
    msg_type = template.get('msg_type')
    try:
        msg_type = int(msg_type) if msg_type not in (None, '') else 2
    except (TypeError, ValueError):
        msg_type = 2
    kwargs = {'buttons': buttons, 'msg_type': msg_type, 'skip_suffix': True}
    if template.get('button_font_size'):
        kwargs['button_font_size'] = template['button_font_size']
    try:
        if group_id:
            ok, data, payload = await sender.send_to_group(group_id, content, **kwargs)
        else:
            ok, data, payload = await sender.send_to_user(user_id, content, **kwargs)
    except Exception as e:  # noqa: BLE001
        log.error('发送模板失败: %s', e)
        return _fail(f'发送异常: {e}', status=500)
    if not ok:
        code = data.get('code') if isinstance(data, dict) else None
        hint = ''
        if code == 40034105:
            hint = '（该群未开启主动消息权限，只能在收到消息后被动回复）'
        elif code == 40034127:
            hint = '（机器人没有该群的 Markdown 模板权限，改用 msg_type=0 纯文本发送）'
        elif code == 11255:
            hint = '（群/用户已注销或 ID 不对）'
        return _fail(f'发送失败 {code}: {data} {hint}', status=502, code='SEND_FAILED')
    return _ok({'ok': True, 'response': data, 'payload': payload})


async def _asset(request):
    filename = request.path.rsplit('/', 1)[-1]
    content_type = _ASSETS.get(filename)
    if not content_type:
        raise web.HTTPNotFound()
    path = _WEB_DIR / filename
    if not await asyncio.to_thread(path.is_file):
        raise web.HTTPNotFound()
    return web.FileResponse(
        path, headers={'Cache-Control': 'no-cache', 'Content-Type': content_type}
    )
