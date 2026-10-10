# 日语假名复习 Windows v1.0.0

用户已明确批准实施：Electron+electron-builder；Windows10/11 x64；安装版与免安装版；沿用当前UI与128项内容；全部离线发音；网页/桌面备份迁移；MIT代码许可；公开GitHub Release；零付费未签名首版。

## 运行
固定app://kana/标准安全协议与io.github.rainbow0408.japanese-kana-review标识；固定当前用户应用数据目录。单实例，关闭退出，无Node/Python/日语系统语音要求。nodeIntegration=false、contextIsolation=true、sandbox=true，页面无通用原生接口；只读取打包网页资源。

## 数据
保留v4状态与kana-flashcards-v1键。备份格式japanese-kana-review-backup、formatVersion=1、exportedAt、state；限制1MiB。导入先校验并展示摘要，再确认覆盖；覆盖前保留旧状态，写入失败恢复；提供上一份状态恢复。坏文件、未来版本不能改变当前数据。网页与桌面共有导入导出流程。

## 发音与授权
VOICEVOX四国めたん・ノーマル，预先生成128个按项目ID命名的24kHz单声道16bit WAV。软件不带合成引擎或模型。核对每个读法与音频完整性，单独は/へ避免助词读音。自有代码MIT，Copyright 2026 Rainbow0408；音频说明、来源和VOICEVOX:四国めたん署名单独保留。

## 发布
原有公开仓库Rainbow0408/japanese-kana-review。合并既有UI修复，测试后Windows构建两个exe和SHA256SUMS.txt。tag v1.0.0工作流仅创建草稿；本地验证成品后公开发布并验证匿名下载。排除任何学习数据、备份、临时文件与开发依赖缓存。

## 验收
38项既有测试及新增数据/桌面/音频测试通过；安装和免安装版本断网、无开发环境/日语语音条件下可学习并播放128发音；学习记录在重开、替换软件与升级后保留；网页备份可迁移；无登录即可下载成品并验证SHA256。
