# 真机等价移动端验证

`tests/lifecycle-harness.html` 用的是人工模拟的 SillyTavern DOM，**不能**证明手机端成立。
这一套跑的是真实浏览器引擎：真实 CSSOM、`getComputedStyle`、`getBoundingClientRect`、
`elementsFromPoint`、真实触摸事件，并且**按 SillyTavern 的真实方式用
`<script type="module">` 加载 index.js**（这正是 `document.currentScript` 恒为 null 的原因）。

```bash
pip install playwright
playwright install chromium webkit
python3 tests/mobile/serve.py &                   # 监听 127.0.0.1:8899
python3 tests/mobile/verify.py chromium            # Blink，退出码 0 = 全绿
python3 tests/mobile/verify.py webkit               # iPhone/Safari 对应引擎
```

覆盖：版本标记、资源 URL 解析策略、样式表健康（正常/过期/缺失）、
五档视口几何、三个入口的真实触摸、pointerup+click 去重、
可见性探针字段完整性、跨实例生命周期归属、observer 节流。

Chromium 与 WebKit 使用同一套断言；WebKit 模式配合脚本内的 iPhone UA、触摸能力和移动视口，专门覆盖 Safari 的层叠、背面可见性、几何与入口事件生命周期。
