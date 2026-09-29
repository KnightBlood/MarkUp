# 流程图冒烟样例

## Mermaid flowchart

```mermaid
flowchart TD
  A[开始] --> B{判断}
  B -->|是| C[执行]
  B -->|否| D[结束]
  C --> D
```

## Mermaid sequence

```mermaid
sequenceDiagram
  participant U as 用户
  participant S as 服务端
  U->>S: 请求
  S-->>U: 响应
```

## flowchart.js 语法

```flow
st=>start: 开始
e=>end: 结束
op=>operation: 处理
cond=>condition: 是否?

st->op->cond
cond(yes)->e
cond(no)->op
```

## 普通代码块（不应被拦截）

```js
console.log('plain fence stays source')
```
