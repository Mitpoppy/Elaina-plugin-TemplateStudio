# Elaina-plugin-TemplateStudio

ElainaBot v2 插件市场收录仓 —— **模板工坊**。

在后台侧边栏新增「模板工坊」页面：可视化编辑 **QQ Markdown 正文 + 内联按钮**，实时预览消息效果，
并把模板导出成 4 种可直接落地的 JSON。

## 安装

### 方式一：插件市场（推荐）

框架后台 → 侧边栏「社区插件仓」→ 搜索「模板工坊」，点安装。

### 方式二：手动

```bash
git clone https://github.com/Mitpoppy/Elaina-plugin-TemplateStudio.git
cp -r Elaina-plugin-TemplateStudio <你的框架>/plugins/tpl_studio
```

> 仓库根目录**就是插件本身**（`main.py` + `services/` + `web/` + `assets/`）。
> 这样市场两种安装方式都能直接用：
> - 官方市场清单：`"type": "complete"`，**不填 `path`** → 整仓库装到 `plugins/<name>/`
> - 社区插件仓：整仓库 zip 安装，同样落成完整插件目录

然后重载插件：面板「插件模块」页点重载，或

```bash
curl -X POST http://127.0.0.1:<端口>/api/plugins/reload \
  -H 'Content-Type: application/json' -H "Origin: http://127.0.0.1:<端口>" \
  -d '{"name":"tpl_studio"}'
```

首次加载会自动写入 `plugins/tpl_studio/data/templates.json`（含 3 个示例模板）。

## 功能

| 区域 | 能力 |
| --- | --- |
| 左栏 | 模板列表 / 搜索 / 新建 / 复制 / 删除 / 导入 / 导出 |
| 中栏 | 基础信息（键、名称、分类、`msg_type`、小按钮、自动 @）、Markdown 正文（变量插入 + 语法参考 + 实时校验）、按钮可视化编辑器（9 字段 + 3 开关，可切 JSON 双向同步） |
| 右栏 | 实时 QQ 预览（正文 + 按钮，按 style 上色）、4 个 JSON 标签页、测试发送 |

内置「字段速查」和「平台限制（实测）」两张表，写模板时不用翻文档。

## 导出的 4 种 JSON

| 标签 | 用途 | 结构 |
| --- | --- | --- |
| `templates.yaml` | 直接贴进 `config/templates.yaml` 对应键下 | `{"<key>": {"content", "buttons"}}` |
| `platform.keyboard` | 平台原生键盘，可直接塞 `payload.keyboard` | `{"content":{"rows":[{"buttons":[{"id","render_data","action"}]}]}}` |
| `插件存储` | 本插件 `data/templates.json` 记录格式 | `{"<key>": {"label","category","content","buttons","msg_type",…}}` |
| `发送 payload` | 单条开放平台消息体 | `{"msg_type","markdown"|"content","keyboard","button_font_size"}` |

**`platform.keyboard` 不是手拼的** —— 直接调用框架 `core/message/keyboard.build_keyboard()`
生成，所以和真正发出去的结构一定一致。

## 按钮字段（框架简写）

| 字段 | 类型 | 说明 | 默认 |
| --- | --- | --- | --- |
| `text` | str | 按钮文字 | 必填 |
| `type` | int | 0 跳转 / 1 回调 / 2 输入 / 4 订阅 | 2 |
| `data` | str | 链接、回调数据或填入聊天框的内容 | — |
| `link` | str | 链接简写，自动变 type=0 | — |
| `show` | str | 点击后显示的替代文字 | 同 text |
| `style` | int | 0 灰 / 1 蓝 / 2 黑 / 3 红字 / 4 蓝底 | 1 |
| `enter` | bool | 点击直发 | false |
| `reply` | bool | 引用回复 | false |
| `limit` | int | 点击次数限制 | — |
| `tips` | str | 客户端不支持时的提示 | — |
| `modal` | str/dict | 二次确认弹窗 | — |
| `subscribe` | str/list/dict | 订阅模板 ID（自动 type=4） | — |
| `group_id` | str | 同值按钮客户端互斥 | — |
| `admin`/`list`/`role`/`permission` | — | 权限，优先级 permission > role > list > admin | 所有人 |

权限优先级：`permission` > `role` > `list` > `admin` > 所有人。
`group_id` 只做客户端互斥，**服务端业务必须自己校验**。

## 平台限制（实测，踩坑记录）

| 现象 | 平台返回 | 原因与对策 |
| --- | --- | --- |
| 主动发消息被拒 | `40034105` | 该群未授权主动消息。给群开权限，或改在收到消息后被动回复 |
| Markdown 发不出去 | `40034127` | 机器人没有该群 Markdown 模板权限。**同内容改 `msg_type=0` 纯文本可发** |
| 请求的资源不存在 | `11255` | 群/用户已注销，或群 ID 不对 |
| 图片/链接被拦 | — | 域名须已在开放平台备案；Markdown 图片必须写 `#宽px #高px` |

## QQ 内命令

```
/模板工坊 list            列出已保存模板
/模板工坊 json <键>       查看模板 JSON
/模板工坊 send <键>       把模板当真实消息发到当前群（含按钮）
```

## 插件结构

```
Elaina-plugin-TemplateStudio/   ← 仓库根 = 插件目录
├── main.py                 # 入口：注册侧边栏页面 + 路由；/模板工坊 命令
├── requirements.txt
├── services/
│   ├── store.py            # data/templates.json 原子写入 + mtime 缓存 + 示例播种
│   └── validate.py         # 校验/规范化；调框架 build_keyboard 生成原生键盘
├── web/
│   └── routes.py           # /api/ext/tpl-studio/* 全部路由
├── assets/
│   ├── panel.html          # 三栏页面
│   ├── panel.css           # 面板样式（跟随宿主主题变量）
│   ├── panel.js            # 编辑器 + 预览 + 4 种 JSON 生成
│   ├── preview.css         # 预览区 QQ 元素样式
│   ├── message-markdown.js # 框架同款 Markdown 渲染器（marked + DOMPurify）
│   └── message-markdown.css
└── data/                   # 首次运行自动生成 templates.json（不入库）
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ext/tpl-studio/meta` | 字段表、变量表、语法参考、平台限制、按钮枚举 |
| GET | `/api/ext/tpl-studio/templates` | 模板列表 |
| GET | `/api/ext/tpl-studio/template?key=` | 单个模板全文 |
| POST | `/api/ext/tpl-studio/template` | 保存 |
| DELETE | `/api/ext/tpl-studio/template?key=` | 删除 |
| POST | `/api/ext/tpl-studio/build` | 校验 + 生成 4 种结构（不落库） |
| POST | `/api/ext/tpl-studio/send` | 真实发送 |
| GET | `/api/ext/tpl-studio/bots` / `groups` | 机器人与群（群含 `can_proactive`） |
| POST | `/api/ext/tpl-studio/import` | 批量导入 |
| GET | `/api/ext/tpl-studio/export?format=` | 全量导出 |

全部路由 `auth=True`（复用面板登录态），静态资源 `auth=False`。

## 移植到其它框架

页面层不依赖后端框架。换框架只改两处：

1. `services/validate.py` 的 `_build_platform_keyboard()` → 换成目标框架的键盘构建函数
   （如 OneBot 11 / NapCat 的 `{"type":"inline_keyboard","data":[{"buttons":[…]}]}`）
2. `web/routes.py` 的 `_send()` → 换成目标框架的发送 API

## 作者

幻想 · MIT License
