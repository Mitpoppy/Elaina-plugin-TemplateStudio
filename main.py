"""模板工坊 (tpl_studio) — ElainaBot v2 插件

侧边栏新增「模板工坊」页面：可视化编辑 Markdown 正文 + 按钮，实时预览 QQ 消息效果，
并导出多种可直接落地的 JSON：

  1. 框架 templates.yaml 片段（content + buttons，按钮是「二维数组 + 简写字段」）
  2. 平台原生 keyboard（build_keyboard 生成的 render_data/action 结构，可直接塞进 payload.keyboard）
  3. 插件模板存储格式（含 label/category/msg_type/small_buttons/at_user）
  4. 单条消息 payload（markdown + keyboard，直接发给开放平台）

QQ 内命令（主人/管理员）：
  /模板工坊 list            列出已保存模板
  /模板工坊 send <键>       把某个模板作为真实消息发到当前群（连按钮一起）
  /模板工坊 json <键>       查看某个模板的 JSON
"""

import os

from core.base.logger import PLUGIN, get_logger
from core.plugin.decorators import handler, on_load, on_unload
from core.plugin.web_pages import register_page, unregister_page

from .services import store
from .web import routes as webpanel

__plugin_meta__ = {
    'name': '模板工坊',
    'author': '幻想',
    'description': '侧边栏可视化编辑 QQ Markdown 消息与按钮，实时预览并导出可直接使用的 JSON',
    'version': '1.0.0',
    'license': 'MIT',
    'github': 'https://github.com/Mitpoppy/Elaina-plugin-TemplateStudio',
}

log = get_logger(PLUGIN, '模板工坊')

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
_PANEL_HTML = os.path.join(_PLUGIN_DIR, 'assets', 'panel.html')
_PAGE_KEY = 'tpl-studio'

_ICON = (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<rect x="3" y="4" width="18" height="16" rx="2"/>'
    '<path d="M7 8h4M7 12h7M7 16h5"/><path d="M16 8h1M17 12h.01M17 16h.01"/></svg>'
)


@on_load
async def init():
    try:
        seeded = store.ensure_seed()
        if seeded:
            log.info('已写入 %s 个示例模板（data/templates.json）', seeded)
    except Exception as e:  # noqa: BLE001
        log.warning('示例模板写入失败: %s', e)
    register_page(
        key=_PAGE_KEY,
        label='模板工坊',
        source='plugin',
        source_name='tpl_studio',
        icon=_ICON,
        html_file=_PANEL_HTML,
    )
    webpanel.register_routes()
    log.info('模板工坊已加载：侧边栏「模板工坊」+ /api/ext/tpl-studio/*')


@on_unload
async def cleanup():
    webpanel.unregister_routes()
    unregister_page(_PAGE_KEY)
    log.info('模板工坊已卸载')


# ---------------------------------------------------------------- QQ 内命令

_HELP = (
    '**模板工坊**\n'
    '- `/模板工坊 list` 列出已保存模板\n'
    '- `/模板工坊 json <键>` 查看模板 JSON\n'
    '- `/模板工坊 send <键>` 发送该模板（含按钮）\n'
    '在 Web 面板「模板工坊」页面可视化编辑。'
)


@handler(r'^/模板工坊(?:\s+(.+))?$', name='tpl_studio', desc='模板工坊: list / json <键> / send <键>',
         group_only=False)
async def handle_command(event, match):
    raw = (match.group(1) or '').strip()
    parts = raw.split(None, 1)
    action = parts[0].lower() if parts else 'list'
    key = parts[1].strip() if len(parts) > 1 else ''

    if action == 'list' or not action:
        items = store.list_templates()
        if not items:
            await event.reply('还没有模板。先在 Web 面板「模板工坊」里新建一个。')
            return
        lines = [f'**模板列表**（共 {len(items)} 个）']
        for item in items[:30]:
            tag = f'〔{item["category"]}〕' if item['category'] else ''
            lines.append(f'- `{item["key"]}` {item["label"]} {tag} · {item["buttons"]} 个按钮')
        await event.reply('\n'.join(lines))
        return

    if not key:
        await event.reply(_HELP)
        return

    template = store.get_template(key)
    if not template:
        await event.reply(f'模板 `{key}` 不存在，用 `/模板工坊 list` 查看。')
        return

    if action == 'json':
        import json
        await event.reply(
            f'```json\n{json.dumps(template, ensure_ascii=False, indent=2)[:1800]}\n```',
            msg_type=2,
        )
        return

    if action == 'send':
        if not event.group_id and not event.raw_user_id and not event.user_id:
            await event.reply('请在群聊或私聊中使用 `/模板工坊 send <键>`。')
            return
        buttons = template.get('buttons') or None
        msg_type = template.get('msg_type')
        kwargs = {'buttons': buttons, 'msg_type': int(msg_type) if msg_type not in (None, '') else 2}
        if template.get('button_font_size'):
            kwargs['button_font_size'] = template['button_font_size']
        data = await event.reply(str(template.get('content') or ''), **kwargs)
        # event.reply 返回开放平台响应 dict；出错时含非 0 code
        if isinstance(data, dict) and data.get('code') not in (None, 0):
            await event.reply(f'发送失败 [{data.get("code")}] {data.get("message", "")}')
        return

    await event.reply(_HELP)
