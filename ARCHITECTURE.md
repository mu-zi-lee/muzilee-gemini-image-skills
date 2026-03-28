# Architecture

## 总体分层

```text
Agent
  -> SKILL.md / CLI
    -> Python daemon
      -> TaskService
        -> TaskQueue + WorkerRegistry
          -> Tampermonkey worker
            -> Gemini Web UI
```

## Python 端

- `contracts/`: 任务协议、能力、错误码、结果模型
- `application/`: setup 预处理、能力推导、任务编排、图片落盘
- `state/`: worker 注册表与任务队列
- `server/`: 标准库 HTTP 服务和路由
- `cli/`: 面向 Agent/人类的命令入口

## Worker 端

- `dom/`: 查询、可见性判断、等待
- `features/chat/`: 新建会话
- `features/model/`: 模型归一化与切换
- `features/upload/`: 参考图粘贴和文件注入
- `features/image/`: 图片提取
- `features/response/`: 文本提取与完成判定
- `features/task/`: setup pipeline
- `runtime/`: heartbeat、task loop、execute_task
- `bridge/`: 历史下载桥接实现，当前 preview-only 流程不依赖

## 协议决定

- Agent 统一入口：`POST /agent/tasks/execute`
- Worker 协议：
  - `POST /api/worker/heartbeat`
  - `GET /api/worker/tasks/next`
  - `POST /api/worker/tasks/{task_id}/result`
- 统一任务信封：

```json
{
  "type": "generate_image",
  "setup": {
    "new_chat": true,
    "model": "pro",
    "reference_images": []
  },
  "input": {
    "prompt": "画一张海边黄昏的电影感海报",
    "output_mode": "preview"
  },
  "timeout_seconds": 180
}
```

## 扩展原则

- 新增页面动作时，优先新增 `features/` 模块，再在 `runtime/execute_task.js` 注册
- 不允许把 DOM 细节塞回 `execute_task.js`
- 通用名词、模型别名、任务类型和能力名必须先落到 `protocol/catalog.json`
- 当前图片读取策略固定为 preview-only，不走网页下载按钮
