"""模板校验/规范化 — 校验 Markdown + 按钮 JSON，并直接调用框架 build_keyboard 生成真实平台键盘结构。"""

from __future__ import annotations

import re

_VAR_RE = re.compile(r'(?<!\{)\{([a-zA-Z_]\w*)\}(?!\})')
_IMG_RE = re.compile(r'!\[[^\]]*\]\(([^)\s]+)')
_CMD_INPUT_RE = re.compile(r'<qqbot-cmd-input[^>]*>')

MSG_TYPES = {0: '纯文本', 2: 'Markdown', 3: 'Ark', 7: '富媒体', 8: '卡片'}

BUTTON_TYPES = {0: '跳转链接', 1: '回调事件', 2: '输入指令', 4: '订阅模板'}
BUTTON_STYLES = {0: '灰框', 1: '蓝框', 2: '黑框', 3: '红字', 4: '蓝底'}
FONT_SIZES = {'': '跟随框架', 'small': '小', 'middle': '中', 'large': '大'}

# 框架 build_keyboard 认识的按钮字段；不在表内的字段会被静默丢弃
KNOWN_BUTTON_FIELDS = {
    'id', 'text', 'type', 'data', 'link', 'show', 'style', 'enter', 'reply', 'limit',
    'tips', 'modal', 'subscribe', 'subscribe_data', 'group_id', 'permission', 'role',
    'list', 'admin', 'render_data', 'action', 'click_limit', 'unsupport_tips', 'anchor',
}

FIELD_REFERENCE = [
    ('text', 'str', '按钮显示文字', '必填（或用 action.render_data.label）'),
    ('type', 'int', '0 跳转 / 1 回调 / 2 输入 / 4 订阅', '默认 2'),
    ('data', 'str', '链接、回调数据或要填入聊天框的内容', 'type 决定含义'),
    ('link', 'str', '链接简写，会覆盖 type 与 data（自动变 type=0）', '与 data 二选一'),
    ('show', 'str', '点击后聊天框/聊天气泡里显示的替代文字', '默认同 text'),
    ('style', 'int', '0 灰框 / 1 蓝框 / 2 黑框 / 3 红字 / 4 蓝底', '默认 1'),
    ('enter', 'bool', '点击后直接发送（开 button_enter_to_send 时 type2→type1）', '默认 false'),
    ('reply', 'bool', '点击后作为引用回复发送', '默认 false'),
    ('limit', 'int', '点击次数限制', '无'),
    ('tips', 'str', '客户端不支持时的提示语', '无'),
    ('modal', 'str|dict', '二次确认弹窗内容', '无'),
    ('subscribe', 'str|list|dict', '订阅模板 ID / ID 列表 / 原生订阅字典（自动 type=4）', '无'),
    ('group_id', 'str', '同值按钮由客户端互斥（单选效果）', '框架自动提到按钮根级'),
    ('admin', 'bool', '仅管理员可点（permission.type=1）', '无'),
    ('list', 'list', '限定可点击用户 ID（permission.type=0）', '无'),
    ('role', 'list', '限定角色 ID（permission.type=3）', '无'),
    ('permission', 'dict', '平台原生权限结构，优先级最高', '无'),
    ('render_data', 'dict', '平台原生渲染结构（label/visited_label/style），字段原样透传', '无'),
    ('action', 'dict', '平台原生动作结构，字段原样透传', '无'),
]

# Markdown 里常用的框架/平台变量（模板里用 {name} 占位，发送时由框架 format_map 替换）
VARIABLES = [
    ('{user_id} / {userid}', '触发者 ID', '所有事件'),
    ('{username} / {nickname}', '触发者昵称', '消息事件'),
    ('{group_id} / {groupid}', '群 ID', '群聊事件'),
    ('{group_name}', '群名称', '群聊事件'),
    ('{member_count}', '群成员数', '群聊事件（需自行传入）'),
    ('{appid} / {botid}', '机器人 AppID', '所有事件'),
    ('{bot_name} / {botname}', '机器人名称', '所有事件'),
    ('{bot_qq}', '机器人 QQ', '所有事件'),
    ('{raw_user_id} / {target_id}', '被处理的目标用户 ID', '群管类事件'),
    ('{time}', '当前时间', '所有事件（需自行传入）'),
    ('{reason}', '入群理由 / 处罚原因', '审批、处罚事件'),
    ('{error_message}', '错误信息', '错误模板'),
    ('{{double}}', '双大括号内容保持字面量，不做替换', '—'),
]

MARKDOWN_SYNTAX = [
    ('**加粗**', '加粗'), ('*斜体*', '斜体'), ('~~删除线~~', '删除线'),
    ('`行内代码`', '行内代码'), ('```块```', '代码块'),
    ('# 一级标题', '标题（1~3 级在 QQ 客户端显示最稳）'),
    ('> 引用', '引用块'),
    ('- 列表项', '无序列表'), ('1. 列表项', '有序列表'),
    ('[文字](https://…)', '超链接，域名需备案'),
    ('![图 #宽px #高px](https://…)', '图片，必须写尺寸，域名需备案'),
    ('<qqbot-cmd-input text="/菜单" show="菜单" />', '指令胶囊：点击直接填充指令'),
    ('<@10001>', '提及用户（用 {user_id} 占位更通用）'),
]

# 平台权限相关限制（实测得出，见 docs/README.md）
PLATFORM_NOTES = [
    ('主动消息', '群必须已授权主动消息权限，否则返回 40034105（无权限）。没授权的群只能在收到消息后被动回复。'),
    ('Markdown', '机器人需要该群的 Markdown 模板权限，否则返回 40034127（无 markdown 模板权限）。纯文本 msg_type=0 通常不需要。'),
    ('链接域名', '按钮 link 与正文里的 http(s) 链接、图片域名都需在开放平台备案，否则消息被拦。'),
    ('图片尺寸', 'Markdown 图片必须写尺寸 ![说明 #宽px #高px](url)，否则客户端可能不渲染。'),
    ('群已注销', '群或用户已注销时返回 11255（请求的资源不存在）。'),
]


def framework_variables() -> list[dict]:
    return [{'token': t, 'label': d, 'scope': s} for t, d, s in VARIABLES]


def field_reference() -> list[dict]:
    return [
        {'name': n, 'type': t, 'desc': d, 'default': dv}
        for n, t, d, dv in FIELD_REFERENCE
    ]


def markdown_reference() -> list[dict]:
    return [{'syntax': s, 'desc': d} for s, d in MARKDOWN_SYNTAX]


def platform_notes() -> list[dict]:
    return [{'topic': t, 'note': n} for t, n in PLATFORM_NOTES]


# ---------------------------------------------------------------- 规范化


def _as_button_list(buttons) -> list[list[dict]]:
    """统一成 [[btn, ...], ...]：接受扁平数组 / 二维数组 / {rows:[{buttons:[...]}]}"""
    errors = []
    if isinstance(buttons, dict):
        buttons = buttons.get('rows') or buttons.get('buttons') or buttons.get('btns') or []
    if not isinstance(buttons, list):
        return [], ['buttons 必须是数组：[[按钮,按钮], [按钮]]']
    rows: list[list[dict]] = []
    if not buttons:
        return [], []
    if all(isinstance(b, dict) for b in buttons):
        buttons = [buttons]  # 扁平数组 → 单行
    for ri, row in enumerate(buttons):
        if isinstance(row, dict):
            row = row.get('buttons') or row.get('btns') or []
        if not isinstance(row, list):
            errors.append(f'第 {ri + 1} 行不是数组')
            continue
        clean = []
        for bi, btn in enumerate(row):
            if not isinstance(btn, dict):
                errors.append(f'第 {ri + 1} 行第 {bi + 1} 个按钮不是对象')
                continue
            unknown = set(btn) - KNOWN_BUTTON_FIELDS
            if unknown:
                errors.append(f'按钮「{btn.get("text", "")}」含框架会忽略的字段: {", ".join(sorted(unknown))}')
            if btn.get('link') is None and btn.get('type') in (0,) and not btn.get('data'):
                errors.append(f'按钮「{btn.get("text", "")}」是跳转类型(type=0)但缺 link/data')
            if not str(btn.get('text') or (btn.get('render_data') or {}).get('label') or '').strip():
                errors.append(f'第 {ri + 1} 行第 {bi + 1} 个按钮缺 text')
            clean.append(dict(btn))
        if clean:
            rows.append(clean)
        elif row:
            errors.append(f'第 {ri + 1} 行没有有效按钮')
    return rows, errors


def _scan_markdown(content: str) -> dict:
    warnings = []
    ok = True
    if not isinstance(content, str):
        return {'ok': False, 'warnings': ['content 必须是字符串'], 'variables': [], 'images': []}
    for m in _IMG_RE.finditer(content):
        url = m.group(1)
        head = content[max(0, m.start() - 40):m.end()]
        if '#' not in head:
            warnings.append(f'图片建议写尺寸：![说明 #宽px #高px]({url})')
        if url.startswith('http://'):
            warnings.append('图片/链接使用 http，QQ 平台通常要求 https 域名')
        if 'qqbot-media://' in url:
            warnings.append('qqbot-media:// 引用仅在上传素材后有效，预览不会显示')
    if re.search(r'(?m)^#\s', content):
        pass
    for m in _CMD_INPUT_RE.finditer(content):
        if 'text=' not in m.group(0):
            warnings.append('qqbot-cmd-input 缺少 text 属性')
    variables = sorted({m.group(1) for m in _VAR_RE.finditer(content)})
    # 花括号配对检查
    stripped = content.replace('{{', '').replace('}}', '')
    if stripped.count('{') != stripped.count('}'):
        ok = False
        warnings.append('花括号数量不匹配，{变量} 可能漏了右括号')
    return {'ok': ok, 'warnings': warnings, 'variables': variables,
            'images': [m.group(1) for m in _IMG_RE.finditer(content)],
            'cmd_inputs': len(_CMD_INPUT_RE.findall(content))}


def _build_platform_keyboard(rows: list[list[dict]], appid: str, font_size: str = '') -> tuple[dict | None, str]:
    """调用框架自己的 build_keyboard，得到真实发送结构（含字号）"""
    if not rows:
        return None, ''
    try:
        from core.message.keyboard import build_keyboard
    except Exception as e:  # noqa: BLE001
        return None, f'框架 keyboard 模块不可用: {e}'
    try:
        return build_keyboard(rows, appid or None, font_size=font_size or None), ''
    except Exception as e:  # noqa: BLE001
        return None, f'build_keyboard 失败: {e}'


def build(payload: dict, appid: str = '') -> dict:
    """校验 + 构建。返回 normalized / framework_buttons / platform_keyboard / errors / warnings"""
    payload = payload if isinstance(payload, dict) else {}
    content = payload.get('content', '')
    if content is None:
        content = ''
    content = str(content)
    buttons = payload.get('buttons')
    if isinstance(buttons, str):
        import json
        try:
            buttons = json.loads(buttons) if buttons.strip() else []
        except ValueError as e:
            return {'ok': False, 'errors': [f'按钮 JSON 解析失败: {e}'], 'warnings': []}

    md = _scan_markdown(content)
    rows, btn_errors = _as_button_list(buttons)
    warnings = list(md['warnings'])

    font_size = str(payload.get('button_font_size') or '')
    if not font_size and payload.get('small_buttons'):
        font_size = 'small'  # small_buttons 开启时按钮统一用小号
    if font_size not in FONT_SIZES:
        warnings.append(f'button_font_size={font_size} 不合法，只能是 small / middle / large')
        font_size = ''

    keyboard, kb_error = _build_platform_keyboard(rows, appid, font_size)

    msg_type = payload.get('msg_type')
    try:
        msg_type = int(msg_type) if msg_type not in (None, '', 'null') else 0
    except (TypeError, ValueError):
        msg_type = 0
    if msg_type not in MSG_TYPES:
        warnings.append(f'msg_type={msg_type} 不是常用值（0 纯文本 / 2 Markdown / 8 卡片）')
    if msg_type == 0 and buttons:
        warnings.append('纯文本模式在部分客户端不渲染按钮，建议用 Markdown（msg_type=2）')
    if msg_type == 0 and re.search(r'\*\*|!\[|\[.+\]\(', content):
        warnings.append('纯文本模式下 Markdown 语法不会被解析，正文会原样显示')
    errors = list(btn_errors)
    if kb_error:
        errors.append(kb_error)

    template = {
        'content': content,
        'buttons': rows,
        'msg_type': msg_type,
        'small_buttons': bool(payload.get('small_buttons')),
        'at_user': bool(payload.get('at_user')),
        'button_font_size': font_size,
    }
    if payload.get('label'):
        template['label'] = str(payload['label'])
    if payload.get('category'):
        template['category'] = str(payload['category'])

    # 框架 templates.yaml 风格的 JSON（可直接放进 config/templates.yaml 对应键下）
    framework_json = {'content': content}
    if rows:
        framework_json['buttons'] = rows

    return {
        'ok': not errors,
        'errors': errors,
        'warnings': warnings,
        'normalized': template,
        'framework_buttons': rows,
        'framework_template_json': framework_json,
        'platform_keyboard': keyboard,
        'markdown': md,
        'stats': {
            'rows': len(rows),
            'buttons': sum(len(r) for r in rows),
            'content_length': len(content),
            'variables': md['variables'],
        },
    }
