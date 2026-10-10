# 日语假名复习

一个免费、离线、无需登录的日语假名闪卡学习工具。提供 Windows 软件，也保留可直接使用的网页版。

[**下载 Windows 软件**](https://github.com/Rainbow0408/japanese-kana-review/releases/latest) · [查看所有版本](https://github.com/Rainbow0408/japanese-kana-review/releases) · [网页版](https://cv.loveming.me/japanese-kana-review/)

## 下载与使用

支持 Windows 10 / 11 的 64 位电脑。下载后无需安装 Node.js、Python、浏览器插件或日语语音组件。

| 文件 | 用途 |
| --- | --- |
| Japanese-Kana-Review-1.0.0-win-x64-setup.exe | 安装版，按向导安装到当前用户并创建快捷方式 |
| Japanese-Kana-Review-1.0.0-win-x64-portable.exe | 免安装版，下载后双击即可运行 |
| SHA256SUMS.txt | 两个下载文件的 SHA-256 校验值 |

请在 GitHub Release 的 **Assets** 中下载上述软件文件。Source code 压缩包是开发源码，需要开发环境才能自行构建。

首次启动后可先在“快速过新内容”中选择一类学习，完成后加入复习池；已经学过基础五十音的用户也可在设置中填写基础进度。

首版未购买代码签名证书，部分 Windows 电脑可能显示发布者或信誉提示。下载入口和文件校验值均在本仓库 Release 中，不承诺消除系统安全提示。

## 功能

- 基础五十音、浊音、半浊音、拗音、促音和长音，共 128 项
- 智能闪卡复习：优先加强模糊和不认识的内容
- 自定义类别、题量、平片假名和复习范围
- 全部假名范围预览、薄弱项专项复习
- 快速浏览新内容、自定义测试、学习记录
- 全部内容随软件提供离线发音
- 学习记录导出、导入和导入前状态恢复
- 无需登录、无后台服务、无付费 API

闪卡快捷键：

- **Space**：显示答案；答案显示后再次按下会选择“认识”并进入下一张。
- **1 / 2 / 3**：认识 / 模糊 / 不认识。

## 学习记录与迁移

软件把学习记录保存在当前电脑用户的应用数据目录。安装版和免安装版共用这份记录；移动或替换程序文件不会移动或清除记录。免安装版的进度不会自动跟随 U 盘到另一台电脑。

浏览器和软件拥有各自的学习记录。迁移方法：

1. 在原来的网页版打开 **设置 → 导出备份**，保存 JSON 文件。
2. 在软件中打开 **设置 → 导入备份**，选择该文件。
3. 检查预览的进度与记录数量，确认后导入。

导入会覆盖当前记录，导入前会保留上一份状态，并可在设置中恢复。文件损坏、版本不受支持、超过 1 MB 或保存失败时，不会用错误内容替换已有记录。

换电脑时使用同样的导出和导入方法。建议定期导出备份；个人学习数据不会上传 GitHub，也不会自动云同步。新版安装会保留应用数据；卸载软件默认保留学习记录。

网页版仍使用 localStorage。清除浏览器网站数据会删除该浏览器的记录；浏览器禁止保存时，页面会提示记录仅在本次打开期间保留。

## 离线发音与许可

所有 128 项发音使用 **VOICEVOX:四国めたん**（ノーマル）预先生成，软件内只包含成品 WAV，不包含合成引擎或语音模型，不依赖联网合成或系统语音。

单音、拗音及发音规则组合均按学习项提供录音；生成参数、来源和读法修正见 [音频说明](assets/audio/README.md)。

自有代码采用 [MIT 许可证](LICENSE)，署名 Rainbow0408。第三方声音另按 [第三方说明](THIRD_PARTY_NOTICES.md) 及对应音源条款使用，音频不适用代码的 MIT 许可证。

## 更新与反馈

首版通过下载新版手动更新，暂不提供自动更新。升级前请导出备份并关闭软件，然后安装新版或替换免安装程序，继续使用原有记录。

问题和建议可提交到 [GitHub Issues](https://github.com/Rainbow0408/japanese-kana-review/issues)，请附软件版本、系统版本和复现步骤。不要公开包含个人学习记录的备份文件。

## 开发与本地运行

开发者需要当前受支持的 Node.js LTS：

```text
npm ci
npm run setup:desktop
npm test
npm start
npm run build:win
```

`setup:desktop` 下载开发时使用的 Electron 运行环境，正常软件用户无需执行这些步骤。

网页可使用根目录的“启动学习器.bat”在浏览器预览。脚本兼容 Node.js 和 Python，不属于软件用户的必需安装步骤。直接打开 index.html 可能遇到浏览器 ES modules 限制，请优先使用启动脚本。

GitHub Pages 可继续从 main 分支的根目录发布静态网页。桌面使用同一套 HTML / CSS / JavaScript 学习功能。

## 构建与发布

GitHub Actions 在提交或 PR 时执行检查和测试。版本标签触发 Windows 构建，生成安装版、免安装版和校验文件，并创建草稿 Release；成品验收通过后才公开发布。

桌面采用 Electron 和 electron-builder，固定 app://kana/ 来源与应用标识，禁止页面访问 Node.js，启用隔离和沙箱。运行时没有本机 HTTP 服务或端口依赖。

```text
index.html / styles.css    共用学习界面
js/                       学习逻辑、v4 存储、备份、音频
desktop/                  桌面窗口与资源协议
assets/audio/             128 项离线发音和授权说明
tests/                    自动测试
tools/                    本地预览、资源生成、校验工具
.github/workflows/        检查、构建和草稿发布
```
