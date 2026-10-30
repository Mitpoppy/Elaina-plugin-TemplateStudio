"""模板工坊存储层 — data/templates.json（原子写入 + mtime 缓存 + 首次运行播种示例）"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time

_PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_PLUGIN_DIR, 'data')
STORE_PATH = os.path.join(DATA_DIR, 'templates.json')

_lock = threading.RLock()
_cache: dict | None = None
_cache_mtime: float | None = None

_VERSION = 1

# ---------------------------------------------------------------- 示例模板（首次运行 / 空库时播种，作为格式参考）

_SEED_TEMPLATES = {
    'welcome-card': {
        'label': '入群欢迎卡片',
        'category': '示例 / 卡片',
        'template': {
            'content': (
                '![logo #64px #64px](https://q.qlogo.cn/qqapp/{appid}/{user_id}/640)\n'
                '欢迎 <@{user_id}> 加入 **{group_name}**！（第 {member_count} 位成员）\n\n'
                '> 发送 `/帮助` 查看我能做的事\n'
                '> 有问题请 @ 管理员'
            ),
            'buttons': [
                [
                    {'text': '查看菜单', 'data': '/菜单', 'type': 2, 'enter': True, 'style': 1},
                    {'text': '签到', 'data': '/签到', 'type': 2, 'enter': True, 'style': 1},
                ],
                [
                    {'text': '群规文档', 'link': 'https://example.com/rules', 'style': 0},
                    {'text': '联系管理员', 'data': '/联系管理员', 'type': 2, 'style': 0},
                ],
            ],
            'msg_type': 2,
            'small_buttons': False,
            'at_user': False,
            'button_font_size': '',
        },
    },
    'feature-menu': {
        'label': '功能菜单（互斥按钮 + 权限）',
        'category': '示例 / 菜单',
        'template': {
            'content': (
                '**功能菜单** — 点击下方按钮直接触发指令\n\n'
                '- 当前群：{group_name}（{group_id}）\n'
                '- 调用者：<@{user_id}>\n'
                '- 机器人：{bot_name}'
            ),
            'buttons': [
                [
                    {'text': '娱乐功能', 'data': '/娱乐菜单', 'type': 2, 'enter': True, 'style': 1,
                     'group_id': 'menu-tab', 'tips': '当前客户端不支持该指令'},
                    {'text': '实用功能', 'data': '/实用菜单', 'type': 2, 'enter': True, 'style': 1,
                     'group_id': 'menu-tab'},
                    {'text': '管理功能', 'data': '/管理菜单', 'type': 2, 'enter': True, 'style': 3,
                     'group_id': 'menu-tab', 'admin': True},
                ],
                [
                    {'text': '官网', 'link': 'https://example.com', 'style': 4},
                    {'text': '二次确认', 'data': '/危险操作', 'type': 2, 'style': 0,
                     'modal': '确认要执行吗？'},
                    {'text': '订阅更新', 'subscribe': 'daily_update', 'style': 0},
                ],
            ],
            'msg_type': 2,
            'small_buttons': True,
            'at_user': True,
            'button_font_size': 'small',
        },
    },
    'review-notice': {
        'label': '审核通知（回调按钮）',
        'category': '示例 / 通知',
        'template': {
            'content': (
                '**新的入群申请**\n\n'
                '> 申请人：<@{user_id}>\n'
                '> 理由：{reason}\n'
                '> 时间：{time}'
            ),
            'buttons': [
                [
                    {'text': '通过', 'data': 'approve_join', 'type': 1, 'style': 1},
                    {'text': '拒绝', 'data': 'decline_join', 'type': 1, 'style': 3},
                ],
            ],
            'msg_type': 2,
            'small_buttons': True,
            'at_user': False,
            'button_font_size': 'small',
        },
    },
}


def empty_payload() -> dict:
    return {'version': _VERSION, 'updated': '', 'templates': {}}


def _now() -> str:
    return time.strftime('%Y-%m-%d %H:%M:%S')


def _read() -> dict:
    global _cache, _cache_mtime
    with _lock:
        try:
            mtime = os.path.getmtime(STORE_PATH)
        except OSError:
            mtime = None
        if _cache is not None and _cache_mtime == mtime:
            return _cache

        data = None
        if mtime is not None:
            try:
                with open(STORE_PATH, encoding='utf-8') as f:
                    data = json.load(f)
            except (OSError, ValueError):
                data = None

        if not isinstance(data, dict):
            data = empty_payload()
        if not isinstance(data.get('templates'), dict):
            data['templates'] = {}
        _cache, _cache_mtime = data, mtime
        return data


def _write(data: dict) -> dict:
    global _cache, _cache_mtime
    with _lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        data['version'] = _VERSION
        data['updated'] = _now()
        fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix='.templates-', suffix='.json')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, STORE_PATH)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        _cache, _cache_mtime = data, os.path.getmtime(STORE_PATH)
        return data


# ---------------------------------------------------------------- 对外 API


def ensure_seed() -> int:
    """空库时写入示例模板，返回播种条数"""
    data = _read()
    if data['templates']:
        return 0
    for key, item in _SEED_TEMPLATES.items():
        data['templates'][key] = {
            'label': item['label'],
            'category': item['category'],
            'updated': _now(),
            **item['template'],
        }
    _write(data)
    return len(_SEED_TEMPLATES)


def list_templates() -> list[dict]:
    data = _read()
    items = []
    for key, item in data['templates'].items():
        if not isinstance(item, dict):
            continue
        items.append(
            {
                'key': key,
                'label': str(item.get('label') or key),
                'category': str(item.get('category') or ''),
                'updated': str(item.get('updated') or ''),
                'buttons': len(_flatten(item.get('buttons'))),
                'content_length': len(str(item.get('content') or '')),
            }
        )
    return sorted(items, key=lambda i: (i['category'], i['key']))


def get_template(key: str) -> dict | None:
    item = _read()['templates'].get(str(key))
    if not isinstance(item, dict):
        return None
    return dict(item)


def all_templates() -> dict:
    return {k: v for k, v in _read()['templates'].items() if isinstance(v, dict)}


def save_template(key: str, template: dict, *, label: str = '', category: str = '') -> dict:
    data = _read()
    record = dict(template)
    record['label'] = str(label or record.get('label') or key)
    record['category'] = str(category or record.get('category') or '')
    record['updated'] = _now()
    data['templates'][str(key)] = record
    _write(data)
    return record


def delete_template(key: str) -> bool:
    data = _read()
    existed = str(key) in data['templates']
    data['templates'].pop(str(key), None)
    _write(data)
    return existed


def import_templates(payload) -> dict:
    """导入 {key: template} 或 [{key, template}]，返回 {imported, skipped}"""
    data = _read()
    imported, skipped = 0, []
    if isinstance(payload, dict) and isinstance(payload.get('templates'), dict):
        payload = payload['templates']
    items = payload.items() if isinstance(payload, dict) else []
    if isinstance(payload, list):
        items = [(str(i.get('key') or ''), i.get('template') or i) for i in payload if isinstance(i, dict)]
    for key, template in items:
        key = str(key or '').strip()
        if not key or not isinstance(template, dict):
            skipped.append(key or '?')
            continue
        record = dict(template)
        record.setdefault('label', key)
        record.setdefault('category', '')
        record['updated'] = _now()
        data['templates'][key] = record
        imported += 1
    if imported:
        _write(data)
    return {'imported': imported, 'skipped': skipped}


def _flatten(buttons) -> list:
    """把 [[btn],[btn]] / [btn] / {rows:[...]} 统一摊平成一维按钮列表"""
    if isinstance(buttons, dict):
        buttons = buttons.get('rows') or buttons.get('buttons') or []
    out = []
    if not isinstance(buttons, list):
        return out
    for row in buttons:
        if isinstance(row, dict):
            row = row.get('buttons') or row.get('btns') or []
        if isinstance(row, list):
            out.extend(b for b in row if isinstance(b, dict))
        elif isinstance(row, dict):
            out.append(row)
    return out
