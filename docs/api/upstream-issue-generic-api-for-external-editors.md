# [Feature] 外部编辑器接入所需的三项通用能力：草稿版本号 / 条件更新 / 带正文的列表

> 这是给 `flare-stack-blog` 上游的 issue 正文，可直接复制粘贴提交。
> 已核对全部结论对应的源码位置见 `docs/api/blogweb-generic-api-gaps.md`。

---

## 背景

我们在写一个 Obsidian 同步插件，按维护者在 PR #134 里的建议改成：**只用现有 API Key + 现有 `/api/admin/*` 通用路由**，不再请求任何 Obsidian 专用接口、专用 token 或专用数据表。

参照仓库自带的 `.agents/skills/flare-stack-blog/scripts/fsb.py`（同一个「外部编辑器」场景），插件要做的是这 5 件事：

1. 把一个 Markdown 笔记转为 TipTap JSON 并**新建**为一篇文章；
2. 之后每次保存把笔记**同步回同一篇**文章；
3. 把网站上的文章**下载**回笔记（含正文）；
4. 一次性把**全部**文章下载到一个文件夹；
5. 当网站那篇在别处被改过时，提示用户选择「用网站的版本」还是「强制用本地版本」。

现有的 `/api/admin/posts` CRUD + `publish`/`unpublish` + `x-api-key` 已经覆盖了 1–3 和 5 的大部分传输需求，但有 **三项通用能力缺口**导致 2、4、5 无法正确实现。下面是具体场景与最小改动建议。

---

## 缺口一：`PATCH` 无前置条件 → 外部编辑器会静默覆盖别人的修改

### 场景

用户笔记本上开着 Obsidian（插件自动保存），同时在浏览器管理后台里编辑同一篇文章。插件上传时，服务端**无条件写入**，后到的请求直接赢，先前那份正文永久丢失，两边的编辑器都不会收到任何错误或提示。

插件要做的是标准的「乐观并发」：拉取时记住版本，写回时带上「我改的是这一版」，不一致就报 409 让用户决策。

### 为什么不能直接用 `updatedAt`

`updatedAt` 看起来像版本号，但有两处不能顶替：

- **精度只有秒**：`migrations/0000_breezy_pretty_boy.sql:11` 是 `integer DEFAULT (unixepoch())`。插件的自动保存防抖约 1.5s，同一秒内的两次写入会得到**完全相同**的 `updatedAt`，前置条件形同虚设。
- **语义是「行变了」而不是「正文变了」**：`PUT /api/admin/posts/{id}/tags` 会调用 `PostRepo.touchPostUpdatedAt`（`src/features/tags/tags.service.ts:184`），只改一个标签就推进版本；客户端随后会误判为「远端内容变了」而去重新下载。

### 建议

**1) Post 暴露一个不透明的 `version`**，出现在 `GET /api/admin/posts/{id}` 与 `includeContent=true` 的列表项中：

```jsonc
// GET /api/admin/posts/42
{
  "id": 42,
  "title": "Hello",
  "slug": "hello",
  "contentJson": { "type": "doc", "content": [ /* ... */ ] },
  "status": "draft",
  "updatedAt": "2026-09-08T10:00:00.000Z",
  "version": "sha256:1f0c…",          // 新增
  "url": "https://example.com/post/hello"  // 新增，见「附带小项」
  // ...其余字段不变
}
```

定义建议：对**草稿可编辑文档**（至少 `title` + `contentJson`，是否含 `slug`/`summary` 由实现决定）做规范化后的 SHA-256，前缀 `sha256:`。客户端**只做字符串相等比较，不解析内容**，所以派生规则以后可以自由调整。

关键要求：`version` **不得**因为标签、分类、封面、置顶、发布状态变化而变化——否则外部编辑器会被这些元数据改动反复触发无意义的重新下载。

**关于实现方式（这一点会决定前置条件是否真的可靠）**：如果 `version` 只在读取时按需计算、不落库，那么条件更新只能写成「先读出来比对，再写回去」，两个并发 `PATCH` 可能同时通过比对，仍然会丢更新。要做到真正原子，`version` 需要作为一列存在 `posts` 上（一次 `ALTER TABLE posts ADD COLUMN version text`，由写入路径维护），校验就退化成一条单语句：

```sql
UPDATE posts SET /* ... */, version = :newVersion
WHERE id = :id AND version = :expectedVersion
```

`returning()` 为空即冲突——D1 上单条语句天然原子，不需要事务、锁或额外的同步表（也就不需要 PR #134 里 `obsidian_post_links` + `db.batch()` 那套机制）。我们倾向这个方案，但如果你更愿意先用「读取时计算 + 尽力而为的比对」，客户端接口完全一样，我们也能接受，只是需要知道这个取舍。

**2) `PATCH /api/admin/posts/{id}` 接受可选 `expectedVersion`**：

```http
PATCH /api/admin/posts/42
x-api-key: fsb_...

{
  "data": { "title": "Hello", "contentJson": { "type": "doc", "content": [] } },
  "expectedVersion": "sha256:1f0c…"
}
```

- 一致 → `200`，返回完整 Post 与**新的** `version`；
- 不一致 → **`409`，不写入任何字段**，并在响应里带上服务端当前版本供客户端做冲突 UI；
- 不传 `expectedVersion`（或传 `null`）→ 保持现在的无条件写入，作为「强制覆盖」。

409 响应体建议：

```jsonc
{
  "defined": true,
  "code": "POST_VERSION_CONFLICT",
  "status": 409,
  "message": "The post changed since it was read.",
  "data": { "current": { /* 完整 AdminPost，含 version */ } }
}
```

（这里沿用 oRPC 现有错误信封即可；客户端会读 `body.data.current`，与 PR #134 里 `normalizeObsidianResponse` 读取的字段一致。）

如果更倾向标准 HTTP 语义，用 `If-Match: "sha256:…"` / `If-Match: *` 也完全可以，客户端两种都接得住；放进 body 只是因为那样会出现在 OpenAPI spec 里，便于其它客户端发现。

---

## 缺口二：`GET /api/admin/posts` 不返回正文，且分页键会变

### 场景

「一次性把全部文章下载到文件夹」需要遍历所有文章的正文。当前列表项**不含 `contentJson`**（`AdminPostListItemSchema`，`src/features/posts/schema/posts.schema.ts:187-197`），只能「1 次列表 + N 次单篇」，N 篇就是 N+1 个请求。

还有两个会**产生错误**的细节：

- **排序键不稳定**：默认按 `updatedAt DESC`（`src/features/posts/data/helper.ts:73-86`）且**没有 `id` tiebreaker**。`updatedAt` 是会被写入改变的列，遍历期间只要有任何一次编辑（包括遍历方自己的上传），后面页的元素就会前移/后移，offset 分页会**漏读或重复**。
- **`limit` 被静默截断**：`getPosts` 里是 `Math.min(limit, 50)`（`src/features/posts/data/posts.data.ts:133`），客户端传 100 只会拿到 50。

### 建议

**1) 给 `GetPostsInputSchema` 增加可选 `includeContent?: boolean`**（默认 `false`，现有调用方与后台 UI 行为完全不变）。为 `true` 时，列表项额外返回 `contentJson` 与 `version`：

```http
GET /api/admin/posts?includeContent=true&sortBy=id&sortDir=ASC&limit=50&offset=0
x-api-key: fsb_...

// 200
{
  "items": [
    {
      "id": 1, "title": "Hello", "summary": null, "slug": "hello",
      "status": "published",
      "publishedAt": "2026-09-01T00:00:00.000Z", "pinnedAt": null,
      "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-02T00:00:00.000Z",
      "contentJson": { "type": "doc", "content": [ /* ... */ ] },  // 新增
      "version": "sha256:1f0c…"                                    // 新增
    }
  ],
  "total": 137,
  "statusCounts": { "draft": 12, "published": 125 }
}
```

客户端用现有的 `total` 判断遍历结束（`offset += items.length` 直到 `offset >= total`），因此**不需要新增 `nextCursor` 字段**。

注意：空草稿的 `contentJson` 是 `null`，客户端会按空 `doc` 处理——这与原先的同步行为一致，不需要特殊处理。

**2) 给 `SortField` 增加 `"id"`**（`src/features/posts/schema/posts.schema.ts:178`）。`buildPostOrderByClause` 已经支持任意 `PostsTable[field]`，`id` 是自增主键、不可变，排序在遍历期间绝对稳定。同时建议给默认排序补上 `id` 作为 tiebreaker。

（如果更愿意做 cursor 分页，把 `cursor` 定义为「上一页最后一篇的 id」、`WHERE id > cursor ORDER BY id ASC` 也同样解决问题——这正是 PR #134 里原本的实现方式。）

**3) 可选**：`includeContent=true` 时允许 `limit` 到 100（每页正文体积由调用方自己控制）。保持 50 也能工作，只是页数翻倍。

---

## 缺口三：`POST /api/admin/posts` 是「取或建空草稿」，不是「创建」

### 场景 A：两块笔记会被挂到同一篇文章上

`createEmptyPost` 会调用 `findReusableEmptyDraft`（`src/features/posts/data/posts.data.ts:177-196`），命中**任何** `trim(title) = ''` 且正文为空的草稿：

```ts
const existing = await PostRepo.findReusableEmptyDraft(context.db);
if (existing) return { id: existing.id };   // 直接复用
```

于是：用户先对笔记 A 执行「创建为网站文章」，随后对笔记 B 再执行一次 → B 会拿到 A 已经用过的那个草稿 id（如果 A 那篇当时还是空的），两篇笔记指向同一篇文章，互相覆盖。

### 场景 B：创建超时后无法安全重试

插件的创建是「`POST` 拿 id → 再 `PATCH` 写正文」两步。若 `POST` 在服务端成功但响应超时，客户端不知道 id；重试只会拿到同一个空草稿，客户端无法区分「这是我刚才创建的那篇」还是「别人留下的空草稿」。

### 场景 C：往返次数

一次「新建并发布」= `POST` + `PATCH` + `PUT /tags` + `POST /publish`，4 次往返，任何一步失败都会留下需要人工清理的半成品。

### 建议

让 `POST /api/admin/posts` 接受**可选的、与 `PATCH` 相同的 `data` 载荷**，并返回创建后的完整 Post：

```http
POST /api/admin/posts
x-api-key: fsb_...

{
  "data": {
    "title": "Hello",
    "summary": null,
    "contentJson": { "type": "doc", "content": [ /* ... */ ] },
    "categoryId": null
  },
  "tagIds": [3, 7]
}

// 200 / 201
{ "id": 43, "title": "Hello", "slug": "hello", "status": "draft",
  "contentJson": { /* ... */ }, "version": "sha256:…", "tags": [ /* ... */ ], /* ... */ }
```

要点：

- `data.slug` 缺省时用现有的 slug 生成器从 `data.title` 生成（保持与后台编辑器一致的去重行为）；
- `data.title` 为空时返回 `400`，**不要**退化成「取或建空草稿」；
- **无 body 或 body 为 `{}` 时保持现有行为**（`{ id }`），这样 `fsb.py posts new` 与后台 UI 完全不受影响。

---

## 这三项到位后，插件的适配方案（行为等价性核对）

下面逐条确认再加上没有功能损失，供评审。

### 调用映射

| 插件的用户操作 | 现在的实现（PR #134 的专用路由） | 适配后（通用路由） |
| --- | --- | --- |
| 创建为网站文章 | `POST /api/obsidian/articles` | `POST /api/admin/posts`（带 `data`）→ 需要发布时再 `POST /api/admin/posts/{id}/publish` |
| 上传已关联的文章 | `PUT /api/obsidian/articles/{id}` | `GET /api/admin/posts/{id}`（本地未改时探测）→ `PATCH /api/admin/posts/{id}` + `expectedVersion` → 需要时 `POST …/publish` 或 `…/unpublish` |
| 下载网站文章 | `GET /api/obsidian/articles/{id}` | `GET /api/admin/posts/{id}` |
| 同步整个文件夹 | `GET /api/obsidian/articles?limit=100&cursor=N` | `GET /api/admin/posts?includeContent=true&sortBy=id&sortDir=ASC&limit=50&offset=N` |
| 冲突弹窗 | 409 `{ error: { code, current } }` | 409 `{ code: "POST_VERSION_CONFLICT", data: { current } }` |
| 删除 | `DELETE /api/obsidian/articles/{id}` | `DELETE /api/admin/posts/{id}` |

### 字段映射（插件返回类型 → 通用 API）

| 插件字段 | 新来源 | 说明 |
| --- | --- | --- |
| `id` | `post.id` | 原样 |
| `title` | `post.title` | 原样 |
| `slug` | `post.slug` | 原样 |
| `content` | `post.contentJson` | `null` 归一为 `{ type: "doc", content: [] }` |
| `revision` + `contentHash` | `post.version` | **两个字段合并成一个不透明字符串**；客户端只做相等比较，`updatedAt`/`revision` 的递增语义不需要保留 |
| `updatedAt` | `post.updatedAt` | 原样（客户端只写入 frontmatter，不做比较） |
| `published` | `post.status === "published"` | 原样 |
| `url` | `post.url`（新增）或客户端用 `publicSiteUrl + /post/ + slug` 拼接 | 客户端已有兜底逻辑，`url` 属于可选增强 |
| `obsidianUri` | 插件本地生成 | 不经过服务端 |

### 副作用语义核对

- **发布快照刷新**：插件的 `uploadFile(published=true)` 在文章已发布时也必须重新 `publish`（而不只是状态切换），否则线上仍显示旧正文。适配后会**无条件**在内容更新后调用 `POST /publish`，与 PR #134 里 `setPublished` 的行为一致。✅
- **取消发布**：期望草稿但当前是 `published` → `POST /unpublish`；当前已是 `draft` → 不调用。与 `setPublished` 的分支等价。✅
- **slug 稳定性**：插件从不在更新时发送 slug，服务端保持原 slug 不变——`PATCH` 的现有语义正好如此。✅
- **`force`（强制覆盖）**：冲突弹窗里用户选「强制上传本地版本」→ 不传 `expectedVersion`。✅
- **空草稿**：`includeContent=true` 会像原来的 `/obsidian/articles` 一样把空草稿也列出来，客户端按空文档处理。✅

### 需要新增的前置条件（已在上面覆盖）

1. `version` 出现在 `GET /{id}` 与 `includeContent=true` 的列表项里；
2. `PATCH` 的 `expectedVersion` + 409 `data.current`；
3. `POST /api/admin/posts` 接受 `data` 并返回完整 Post；
4. `sortBy=id`（或 id 游标分页）。

四项对现有调用方都是**向后兼容**的。唯一涉及 schema 的是 `version` 列（一次 `ALTER TABLE posts ADD COLUMN`，上游当前最新迁移是 `migrations/0021_friend_link_account_email.sql`），既不改变现有查询也不影响后台 UI。

### 参考实现（改动面很小，且能复用现有工具）

| 改动 | 位置 | 说明 |
| --- | --- | --- |
| `SortField` 增加 `"id"` | `src/features/posts/data/helper.ts:7` 与 `src/features/posts/schema/posts.schema.ts:178` | `buildPostOrderByClause` 本身已经是 `PostsTable[field]`，不需要改逻辑；顺便给默认排序补上 `id` tiebreaker |
| `documentVersion()` | 新增约 10 行，紧挨 `src/features/posts/utils/sync.ts:3` 已有的 `calculatePostHash` | 同一个写法，只 hash `{ title, slug, summary, contentJson }`。**不要**直接复用 `calculatePostHash`——它把 `tagIds`/`categoryId`/`coverMediaId`/`publishedAt`/`pinnedAt` 也算进去了，那些元数据一改就会让外部编辑器误判「正文变了」并触发整篇重新下载 |
| 列表返回正文与版本 | `src/features/posts/data/posts.data.ts:119-136` 的 select，加上 `AdminPostListPageSchema` | `includeContent` 为真时多 select 一列 `contentJson` |
| `posts.version` 列 + 迁移 | `migrations/`（新增一个 `ALTER TABLE posts ADD COLUMN version text`，回填现存行） | 条件更新要原子，版本必须落库，见上面「关于实现方式」 |
| `expectedVersion` 校验 | `src/features/posts/services/posts.service.ts:340` 与 `src/features/posts/data/posts.data.ts:486` 的 `updatePost` | `.where()` 上追加 `eq(PostsTable.version, expectedVersion)`，`returning()` 为空即冲突；写入路径同时更新 `version` |
| `POST` 带 `data` | `src/features/posts/services/posts.service.ts:228` 的 `createEmptyPost` 旁 | 有 `data` → `generateSlug` + `PostRepo.insertPost`；无 `data` → 保留现有 `findReusableEmptyDraft` 分支 |

---

## 兼容性

| 改动 | 对现有调用方的影响 |
| --- | --- |
| `version` 字段 | 纯新增；后台 UI 与 `fsb.py` 忽略未知字段 |
| `expectedVersion` | 可选；不传即当前行为 |
| 409 `POST_VERSION_CONFLICT` | 只有传了 `expectedVersion` 才可能出现 |
| `includeContent` | 默认 `false`；不改响应结构，只在 `true` 时给列表项加两个可选字段 |
| `sortBy=id` | 枚举扩项；后台 UI 不传 `sortBy` 时仍走 `updatedAt` |
| `POST /api/admin/posts` 带 `data` | 无 body / `{}` 时行为与现在完全一致 |

---

## 明确**不**需要的东西

为了不扩大改动面，这里也记录我们**已经放弃**的请求（PR #134 中的部分）：

- ❌ 专用 `/api/obsidian/*` 路由；
- ❌ 专用 Bearer token / 中间件；
- ❌ `obsidian_post_links` 表（映射关系与本地 hash 都保存在笔记 frontmatter 里）；
- ❌ 响应里的 `obsidianUri`（`obsidian://` 链接由插件本地生成）；
- ❌ 按路径分叉的错误信封。

唯一无法在客户端侧解决、因此需要服务端配合的，就是上面三项。

---

## 附带小项（不阻塞，可另开 issue）

1. **`UpdatePostInputSchema` 建议 `.strict()`**。`PostUpdateSchema` 来自 `createUpdateSchema`（`z.object()`，默认 strip）且显式 `.omit({ status, publicSlug })`，所以 `PATCH` 发送 `{"data":{"status":"published"}}` 会得到 **`200` 但仍然是草稿**，没有任何提示。外部编辑器 / 脚本 / agent 很容易踩。返回 `400` 并提示「发布请用 `/publish`」会友好得多。
2. **响应里暴露 `publicSlug` 或 `url`**。当前任何响应都不含 `publicSlug`。虽然发布时 `publicSlug` 就等于 `slug`（`buildPublicSnapshot` 用 `post.slug`），客户端可以自行拼接，但由服务端给出规范的公开 URL 更稳妥（自有域名、编码规则、未来可能的前缀变化都由服务端掌握）。
3. **媒体上传**（单独场景，与上面三项无关）：`POST /api/admin/media` 目前只接受 `multipart/form-data`、上限 10MB、白名单只有 `jpeg/jpg/png/webp/gif`。非浏览器客户端（例如 Obsidian 的 `requestUrl` 不支持 `FormData`）必须手写 multipart 编码；vault 里常见的 `.svg`/`.avif` 会被拒。如果以后想让外部编辑器支持「把本地附件一起上传」，希望增加一个「裸二进制 + `Content-Type`」的上传变体，并明确 SVG 是被安全策略拒绝还是允许。**这一项当前不影响插件工作**（插件现在只引用外链图片），可以完全独立讨论。

---

## 期望

只要上面三项（`version` + `expectedVersion` + `includeContent`/`sortBy=id` + `POST` 带 `data`）落地，我们会把插件完全改写成「`x-api-key` + 现有 `/api/admin/*`」的实现并回来更新 PR，届时不再有任何 Obsidian 专属内容。

---

## 如果需要，这部分我可以来实现

我们不介意自己动手，但**希望先就接口形状达成一致**再写代码，避免又出现方向性返工。具体想先确认三件事：

1. **`version` 的派生口径**：是否纳入 `slug` / `summary`。我们建议纳入——这样在后台改了标题或摘要，外部编辑器也会正确地重新同步一次；
2. **列名与形态**：`version` / `content_hash` / 其它？不透明字符串（`sha256:…`）还是纯 hex？我们只做相等比较，两种都可以；
3. **`POST /api/admin/posts` 带 `data` 时是否还保留 `findReusableEmptyDraft` 兜底**。我们建议只在**没有** `data` 时才走它；但这会影响后台 UI 的「新建文章」按钮，你们比我清楚那边的取舍。

确认之后我可以按你们的偏好来做：

- **拆成 3 个独立的小 PR**，每个都能单独评审、单独合入，不合其中任何一个都不影响另外两个：
  1. `posts.version` 列 + 迁移（含对现存行的回填）+ `expectedVersion` / 409；
  2. `includeContent` + `sortBy=id` + `id` tiebreaker；
  3. `POST /api/admin/posts` 接受 `data`。
- 每个 PR 按仓库现有风格补 `src/features/posts/posts.integration.test.ts` 的集成测试，并跑通 `bun run check` 与 `bun test`；
- 迁移我会先在自己的 D1 上走一遍 `bun run db:generate` + 本地迁移，再验证远端；后台 UI 的请求完全不改、理论上零影响，但我会实测并把结果写进 PR 描述。

如果你们更愿意自己实现，也完全没问题——只要接口形状按上面的来，我们这边只改插件，不用你们等。

另外补充一点背景：PR #134 里我已经实现过等价的并发语义（`revision` + `content_hash` 比对、冲突时 409 返回服务端当前版本）。把同样的语义换成通用字段其实是**减法**——去掉专用路由、专用 token、`obsidian_post_links` 表，以及 `db.batch()` 里那套条件更新技巧——不是往核心里加复杂度。
