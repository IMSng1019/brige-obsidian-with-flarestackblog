# 通用 HTTP API 与 Obsidian 桥接插件的能力缺口分析

> 分析对象：`blogweb`（上游 v2，`upstream/main` = a349320d）与 `brige-obsidian-with-flarestackblog`（Obsidian 插件，`master` = 1fed00e）
> 分析方式：逐文件比对源码，未做线上探测（`https://blog.imsng.top/api/spec.json` 当前返回 404）。
> 结论：上游的**鉴权与传输层是通用的、够用的**；缺的不是 Obsidian 专用接口，而是**外部编辑器通用语义**——并发前置条件、批量带正文读取、原子创建、富媒体上传。这恰好是维护者所说"缺少必要能力可以单独提出具体场景"的那一类。

---

## 一、上游通用 API 现状（事实清单）

### 1.1 鉴权
| 事实 | 位置 |
| --- | --- |
| `x-api-key: fsb_…` 头即可换到 Admin 会话 | `src/lib/auth/auth.config.ts:28-37`（`enableSessionForAPIKeys: true`） |
| API Key 等价于 Admin，可调用全部 `adminProcedure` 路由 | `src/lib/orpc/procedure.ts:63-87` |
| API Key 不能管理 API Key | `src/lib/auth/api-key-guard.ts:19-41` |
| 插件侧目前发的是 `Authorization: Bearer`，需要改成 `x-api-key` | 插件 `src/api/client.ts:48-50` |

### 1.2 路由总量
`src/features/*/server/router.ts` 中共 **88 条** `.route()`，与写作相关的 Admin 路由：

```
GET    /api/admin/posts                          列表（无正文，limit 硬上限 50，offset 分页）
GET    /api/admin/posts/{id}                     单篇（含 contentJson）
GET    /api/admin/posts/slug?title=&excludeId=   生成 slug
POST   /api/admin/posts                          取或建"空草稿"，返回 { id }
PATCH  /api/admin/posts/{id}                     body = { data: {...} }，全字段可选
DELETE /api/admin/posts/{id}
POST   /api/admin/posts/{id}/publish
POST   /api/admin/posts/{id}/unpublish
PUT    /api/admin/posts/{postId}/tags            body = { tagIds }
GET    /api/admin/posts/{postId}/tags
GET    /api/admin/posts/{postId}/revisions       （publish 时才会产生）
POST   /api/admin/posts/{postId}/revisions/{revisionId}/restore
POST   /api/admin/media                          multipart 字段名 image
POST   /api/admin/media/import                   body = { url }
GET    /api/admin/media
GET    /api/admin/tags | /api/admin/categories
```

### 1.3 三个关键 Schema 事实
```ts
// src/features/posts/schema/posts.schema.ts:215-218
UpdatePostInputSchema = z.object({ id: z.number(), data: PostUpdateSchema })

// :33-39  data 是全可选部分更新；显式丢弃 publicSnapshotJson / publicSlug / status
PostUpdateSchema = createUpdateSchema(PostsTable, {...}).omit({
  publicSnapshotJson: true, publicSlug: true, status: true,
})

// :187-197  列表项：id/title/summary/slug/status/publishedAt/pinnedAt/createdAt/updatedAt
//           >>> 没有 contentJson <<<
// :86-96    单篇：PostSelectSchema 去掉 publicSlug，加 cover/hasPublicSnapshot/…
//           >>> 没有 publicSlug、没有公开 URL <<<
```

**没有** `ETag` / `If-Match` / `version` / `revision` / `contentHash` 任何形式的乐观并发原语（全仓库唯一 `ETag` 在 `src/features/media/service/media.service.ts:296`，是 R2 对象头的）。

### 1.4 错误信封
oRPC 的 `OpenAPIHandler` 直接序列化 `ORPCError`：

```jsonc
// node_modules/@orpc/client/dist/shared/client.CZlviB0y.mjs:133-141
{ "defined": true, "code": "POST_NOT_FOUND", "status": 404, "message": "Post not found.", "data": {…} }
```

没有 `error` 外层包裹，也没有 `requestId`。仓库自带测试也确认了这一点（`src/features/api-keys/api-keys.integration.test.ts:42`）。

### 1.5 时间戳精度
```
migrations/0000_breezy_pretty_boy.sql:11   `updated_at` integer DEFAULT (unixepoch()) NOT NULL   -- 秒级
src/lib/db/schema/helper.ts:8-11           .$onUpdate(() => new Date())
src/features/tags/tags.service.ts:184      setPostTags → PostRepo.touchPostUpdatedAt()
```

---

## 二、插件真正需要什么（从代码提取，不是从 PR 描述推断）

| # | 插件能力 | 代码位置 | 依赖的服务端语义 |
| --- | --- | --- | --- |
| N1 | 按 id 拉单篇（含 TipTap 正文） | `client.ts:74` / `sync-service.ts:71,139` | GET 单篇返回 contentJson |
| N2 | 分页拉全量（含正文）用于"同步到文件夹" | `client.ts:68` / `sync-service.ts:107-134` | 列表 + 每篇正文 |
| N3 | 创建文章并拿回 id | `client.ts:78` / `sync-service.ts:55` | 一次调用写入 title/slug/content/path/published |
| N4 | 条件更新：本地 `revision` + `contentHash` 与服务端一致才写 | `sync-service.ts:77-86` | 前置条件校验 + 不一致时 409 |
| N5 | 409 时拿到"服务端当前版本"用于冲突弹窗 | `ui/conflict-modal.ts:16-17` | 409 响应体里带 current 文档 |
| N6 | 强制覆盖（用户已人工确认） | `sync-service.ts:62,78-86`（`force`） | 跳过前置条件 |
| N7 | 删除 | `client.ts:86` | DELETE |
| N8 | 发布 / 取消发布 | `sync-service.ts:50-55,182,280` | publish / unpublish |
| N9 | 变更探测（不下载正文就知道远端变了） | `sync-service.ts:70-76,124` | 列表里每篇带可比对的版本标识 |
| N10 | 生成公开链接（写进 frontmatter `url`） | `sync-service.ts:147` | 公开 URL 或 publicSlug |
| N11 | 上传 vault 附件（**当前刻意未实现**） | `docs/api/obsidian-sync.md:17` | 媒体上传 |
| N12 | 统一错误码解析 | `client.ts:10-22` | `{error:{code,message,current}}` |

---

## 三、比对结果

| # | 需求 | 通用 API | 判定 |
| --- | --- | --- | --- |
| N1 | 单篇 + 正文 | `GET /api/admin/posts/{id}` → `contentJson` | 直接可用 |
| N2 | 全量 + 正文 | 列表**不含** `contentJson`，只能 1+N 次请求；且 `limit` 被 `Math.min(limit,50)` 截断、offset 分页、默认按 `updatedAt DESC` 排序不稳定 | **缺口 G4** |
| N3 | 原子创建 | `POST` 只建空草稿、只回 `{id}`，且会**复用**任意已存在的空草稿 | **缺口 G3** |
| N4 | 条件更新 | 完全无条件 PATCH | **缺口 G1（最关键）** |
| N5 | 冲突带 current | 不存在 409 | G1 的必然结果 |
| N6 | force | 无条件写入即"永远 force" | 语义缺失，见 G1 |
| N7 | 删除 | `DELETE /api/admin/posts/{id}` | 直接可用 |
| N8 | 发布 | `POST …/publish`、`…/unpublish` | 可用（但见 G7） |
| N9 | 变更探测 | 列表有 `updatedAt`，但秒级、且改标签也会跳 | **缺口 G2** |
| N10 | 公开链接 | 任何响应都不含 `publicSlug`/`url`（发布后 `publicSlug === slug`，可用 `slug` 兜底） | 可绕过，建议补 |
| N11 | 附件上传 | `POST /api/admin/media` 存在，但仅 multipart、10MB、仅 jpeg/jpg/png/webp/gif | **缺口 G5** |
| N12 | 错误码解析 | 信封是 `{defined,code,status,message,data}` | 插件侧适配即可 |

---

## 四、真缺口详解

### G1【最关键】PATCH 无乐观并发前置条件 → 外部编辑器静默覆盖

**场景**：Obsidian 在笔记本上，浏览器编辑器 / 另一台设备的 Obsidian 同时在写同一篇。插件上传时校验的是本地 frontmatter 里的 `revision` + `contentHash`；通用 API 的 PATCH 是**无条件写入**，后到的请求直接赢，先到的那份正文永久丢失，双方都不会收到任何错误。

**现状**：
- `PATCH /api/admin/posts/{id}` 只有 `{ data }`，没有 `expectedUpdatedAt` / `If-Match` / `version`。
- 唯一可当版本用的 `updatedAt` 有两处不适合：
  1. **秒级精度**（`unixepoch()`）。插件自动保存防抖 1.5s，同一秒内两次写入会得到完全相同的 `updatedAt`，前置条件形同虚设。
  2. **语义是"行变了"而不是"正文变了"**：`PUT /api/admin/posts/{id}/tags` 会调 `touchPostUpdatedAt`，改个标签就把版本推进一步。
- 所以插件目前无法用通用 API 表达"我改的是我拉下来的那一版"。

**建议（通用、非 Obsidian 专用）**：
1. `GET /api/admin/posts/{id}` 与列表项返回一个稳定的 `version`（或真 `ETag`），由 `contentJson + title + slug` 派生；
2. `PATCH` 接受可选 `expectedVersion`（或标准 `If-Match`）；不匹配时返回 **409**，响应体带当前 Post（供客户端做冲突 UI）；
3. `force: true` / `If-Match: *` 表示无条件覆盖。

这三条不引入任何 Obsidian 概念，任何外部编辑器（VS Code、脚本、AI agent）都需要。

---

### G2 列表缺少可比对的"内容版本"

**场景**：插件的 `syncFolder()` 先分页拉全量列表，逐篇比对本地 `revision`/`contentHash`，只对变化的下载正文。这是"不下载正文就能知道远端变了"的关键。

**现状**：`AdminPostListItemSchema` 只有 `updatedAt`，而它是秒级且被标签变更污染的（见 G1）。

**建议**：G1 的 `version` 同时出现在列表项里即可。**不要**为此新建 `obsidian_post_links` 这类同步状态表——版本号属于 Post 本身。

---

### G3 `POST /api/admin/posts` 不是"创建"，是"取或建空草稿"

**场景 A（数据错乱）**：`findReusableEmptyDraft` 会命中**任何** `trim(title)=''` 且正文为空的草稿（`posts.data.ts:177-196`，取最近 20 条里第一个匹配）。两块笔记连续"创建为网站文章"、或前一次创建后正文写入失败，第二次的笔记会挂到第一篇草稿上。

**场景 B（重试丢 id）**：插件创建是"POST 拿 id → 再 PATCH 写正文"两步。若 POST 成功但响应超时，插件不知道 id；重试又只会拿到同一个空草稿，无法区分"该复用"还是"该新建"。

**场景 C（往返次数）**：一次"新建并发布" = POST + PATCH + PUT tags + POST publish，共 4 次往返，中途任何一次失败都会留下半成品。

**建议**：让 `POST /api/admin/posts` 接受与 PATCH **相同**的 `data` 载荷（title/slug/summary/contentJson/categoryId/tagIds/publishedAt），返回创建后的完整 Post；请求体为空时保持现有"取或建空草稿"行为，兼容上游 `fsb.py`。这样场景 A/B/C 一并消失，且仍然完全是通用语义。

---

### G4 批量读取正文：1+N 与不稳定的分页

**现状**：
- 列表项**没有** `contentJson`，全量同步 N 篇 = 1 + N 个请求。
- `getPosts` 里 `limit` 被 `Math.min(limit, 50)` 静默截断（`posts.data.ts:133`），插件原本按 100/页设计。
- 分页是 offset 而非 cursor，默认排序 **`updatedAt DESC` 且无 `id` 作为 tiebreaker**（`data/helper.ts:73-86`）。同步过程本身在 PATCH，每写一篇就把该篇顶到第一页，后续 offset 会**漏读或重复**——这是真实会产生错误的组合。

**建议**：任选其一即可
- `GET /api/admin/posts?includeContent=true`（或 `fields=` 投影），并允许 `limit` 到 100；
- 或给 `GET /api/admin/posts` 增加 cursor 分页（`cursor` 用 `updatedAt,id` 复合键），至少补上 `id` tiebreaker。

---

### G5 媒体上传对非浏览器客户端不友好

**现状**（`src/features/media/media.schema.ts:3-10`、`server/router.ts:41-60`）：
- 只接受 `multipart/form-data`，字段名 `image`；
- `MAX_FILE_SIZE = 10MB`；
- 允许类型仅 `image/jpeg|jpg|png|webp|gif`。

**对 Obsidian 的实际影响**：
- Obsidian 的 `requestUrl` **不支持 `FormData`**，必须手写 multipart 拼接（上游 `.agents/skills/flare-stack-blog/scripts/fsb.py:271-291` 就是手写的）。插件侧可行但要自己实现编码器并处理 CRLF 边界。
- vault 里大量存在 **`.svg`**（Excalidraw / Mermaid / 图标）与 **`.avif`**、`.bmp`；svg/avif 会被 400 拒掉。
- 手机截图、长图经常 > 10MB。
- 正因如此，插件目前**刻意不上传附件**（`docs/api/obsidian-sync.md:17`），图片只能保持外链——这直接削弱了"用 Obsidian 写作"的体验。

**建议**：
- 增加"裸二进制 + `Content-Type`"的上传变体（对任何非浏览器客户端都更简单），或至少提供 base64 JSON 变体；
- 放宽 MIME 到 `image/*` 并单独说明 SVG 的安全策略（若因 XSS 拒绝 SVG，请在文档里明确写出，便于插件给出可读提示）；
- 提高或可配置 `MAX_FILE_SIZE`。

---

### G6 错误信封与静默丢弃（次要，但值得提）

- **信封**：插件期望 `{error:{code,message,current,requestId}}`，上游是 `{defined,code,status,message,data}`。这一条**插件侧改适配层**即可，不需要上游配合；但建议上游在 `data` 里带 `requestId`，便于用户报障。
- **静默丢弃**：`PostUpdateSchema` 是 `z.object()`（默认 strip，见 `node_modules/drizzle-zod/index.mjs:274`），且显式 `.omit({ status, publicSlug })`。外部客户端若发送 `{"data":{"status":"published"}}` 会得到 **200 + 仍然是草稿**，没有任何告警。对外部编辑器/脚本/agent 来说这是很容易踩的坑。
  **建议**：`UpdatePostInputSchema` 用 `.strict()`（或对 `status`/`publicSlug` 返回 400 并提示"publish 请用 `/publish`"）。

---

### G7 发布与正文不原子（优先级低，可接受）

"保存并发布" = PATCH 正文 + PUT tags + POST publish 三次调用。若最后一次失败，正文已存但线上仍是旧快照——这符合上游 Publishing Intent 的领域模型，**不建议为此改核心**；但若 G3 落地（POST 带 data），至少"新建即发布"能收敛成一次调用。

---

## 五、PR 里其实**不需要**上游接受的部分（维护者判断正确）

| PR 中的东西 | 为什么可以去掉 |
| --- | --- |
| `OBSIDIAN_SYNC_TOKEN` 专用 Bearer 中间件（`obsidian-sync/server/router.ts:33-43`） | `x-api-key` + `adminProcedure` 已经等价，且密钥可单独吊销、可命名 |
| `/api/obsidian/articles/*` 五条专用路由 | 与 `/api/admin/posts/*` 重复，只差"列表带正文"和"条件更新"，应把这两点补进通用路由 |
| `obsidian_post_links` 表（`migrations/0022`、`0023`） | `obsidianPath` 只用于反推 `obsidian://` URI，而插件本来就用 frontmatter 里的 vault 路径自己拼（`sync-service.ts:151`）；表里真正不可替代的只有 `revision` + `content_hash`，那恰恰应该是 **Post 的通用版本号**（G1/G2），而不是一张 Obsidian 专属表 |
| 响应里的 `obsidianUri` 字段（`obsidian-sync.service.ts:112-114`） | 纯客户端关注点；且两者格式还不一致（服务端 `obsidian://open?file=`，插件 `obsidian://open?vault=…&file=`） |
| `normalizeObsidianResponse` 中间件（`api.$.ts:5-44`） | 只为迁就插件的错误信封，把适配移到插件侧即可；否则通用端点会按路径分叉出两种错误格式 |

**唯一真正无法在插件侧自己解决的，是 G1/G2（并发与版本）、G3（原子创建）、G4（批量正文）**——这也是回复维护者时应该聚焦的四条。

---

## 六、给维护者的 issue 草稿（可直接用）

> **标题**：外部编辑器接入：需要条件更新、内容版本与批量正文读取
>
> 我们在做 Obsidian 桥接插件（纯 `x-api-key` + 现有 admin 路由，不新增任何 Obsidian 专用端点），接入时发现四个通用能力缺口：
>
> 1. **PATCH 无条件写入**。外部编辑器无法表达"我改的是我拉下来的那一版"，桌面上传会静默覆盖浏览器里正在编辑的内容。`updatedAt` 不能顶替：它是 `unixepoch()` 秒级，且改标签也会推进。**期望**：GET/列表返回 `version`（或 ETag），PATCH 支持 `If-Match`/`expectedVersion`，不匹配返回 409 + 当前 Post；`force`/`If-Match: *` 表示覆盖。
> 2. **`POST /admin/posts` 是"取或建空草稿"**，会复用任意空草稿（`findReusableEmptyDraft`），外部客户端在"创建失败重试"或"连续创建两篇"时会挂错草稿。**期望**：允许 POST body 直接接受与 PATCH 相同的 `data`（可含 `tagIds`）并返回完整 Post；空 body 保持旧行为。
> 3. **列表不含 `contentJson`**，全量拉取是 1+N，且 `limit` 被 `Math.min(limit,50)` 截断、offset 分页默认按 `updatedAt DESC` 且无 `id` tiebreaker——同步过程本身在写库，会漏读/重复。**期望**：列表支持 `includeContent=true` 或 cursor 分页 + `id` tiebreaker。
> 4. **媒体上传只支持 multipart 且 MIME 受限**。非浏览器 HTTP 客户端（Obsidian `requestUrl` 不支持 `FormData`）需要手写 multipart；vault 常见的 `.svg`/`.avif` 被拒，10MB 上限偏低。**期望**：增加裸二进制/Content-Type 上传变体，放宽 MIME（或明确说明 SVG 因安全被拒）、提高上限。
>
> 附带小项：`UpdatePostInputSchema` 建议 `.strict()`——目前发 `{"data":{"status":"published"}}` 会静默 200 但仍是草稿；`publicSlug` 未出现在任何响应里，外部客户端算不出规范公开 URL。

---

## 七、结论

- 上游说"API 够通用、不该加 Obsidian 专用接口"——**这个判断是对的**：PR 里的专用路由、专用 token、`obsidian_post_links` 表和 `obsidianUri` 字段确实都不该进核心。
- 但"通用 API 已经够用"**不成立**。桥接插件 12 项需求里，**3 项真缺口 + 3 项弱缺口**：条件更新（G1）、原子创建（G3）、批量正文/分页（G4）是真缺口；`updatedAt` 冒充版本号（G2）、媒体上传（G5）、静默丢弃未知字段（G6）是弱缺口。
- 四个真缺口全部是**外部编辑器通用需求**，与 Obsidian 无关，符合维护者"可以单独提出具体场景"的口径。
- 因此下一步不是重开 PR，而是：**插件侧先改成 `x-api-key` + 通用 admin 路由**（能跑通 N1/N7/N8/N10），同时把第六节的 issue 提上去换取 G1/G3/G4。
