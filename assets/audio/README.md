# 日语学习音频

语音署名：**VOICEVOX:四国めたん**（ノーマル）。

本目录的 128 个 WAV 均为本项目使用官方 VOICEVOX CORE 0.17.0、官方 0.vvm 0.17.0 音色模型生成的合成语音，格式统一为 24 kHz、单声道、16-bit PCM。文件名对应 `STUDY_ITEMS` 的稳定 ID，网页直接播放本地文件，无需联网、付费 API 或浏览器系统语音。

这些音频及音频中间表示不适用项目代码的 MIT 许可证。使用、修改、再分发音频时须保留 **VOICEVOX:四国めたん** 署名，并遵守 [TERMS.md](TERMS.md) 及其中的官方条款。项目没有打包语音引擎、模型或第三方可执行文件。

## 生成与核查记录

`generation-manifest.json` 记录官方公共下载地址、版本、SHA256、实际选出的角色/风格/ID、全部输入文本、发音覆盖、原始查询、用于合成的完整查询、逐项音素比对结果、WAV SHA256 和声音信号统计。每个文件的 RIFF 结构、采样格式、长度、非静音和非削波信号均有自动检查。

128 项的音素均与课程预期逐项比对，包括全部 33 个单拍拗音、12 个含 `cl` 的促音词组及 12 个长音词组。特殊处理如下：

- 独立假名采用片假名输入，避免「は / へ」被当成助词；音素分别为 `ha / he`。
- 「を」按现代标准日语读作 `o`；「ん」使用 `N` 音素，并至少保持 0.25 秒。
- 独立音节的元音至少保持 0.19 秒，取消其元音无声化，便于辨音。
- 「せんせい」的默认词典查询为 `se N se i`，采用 AquesTalk 风格的显式假名 `センセ'エ`，得到教材所需的 `se N se e` 长音读法；展示文字仍为「せんせい」。

自动音素和信号核查不等于真人或日语母语者试听。本次未完成人工逐条试听，合成语音仍可能有不自然的音色、节奏或重音；教材中的罗马字描述发音规则，不表示已经验证了所有词语的标准词汇重音。

## 使用相同版本重新生成（Windows CPU）

需要 Node.js 和 Python 3.10 或更新版本；不需要安装 Python 第三方包。以下下载文件约 90 MB，全部置于 Git 已忽略的 `tmp/voicevox/`。官方完整引擎包含很多额外音色，本配方只下载所需的一个 VVM。

先在项目根目录运行以下 PowerShell 命令，按 manifest 的版本和哈希下载并核对来源：

```powershell
$audioRecipe = Get-Content -LiteralPath 'assets/audio/generation-manifest.json' -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path 'tmp/voicevox' -Force | Out-Null
foreach ($audioSource in $audioRecipe.generator.sources) {
  $audioFilename = [IO.Path]::GetFileName(([Uri]$audioSource.url).AbsolutePath)
  $audioArchive = Join-Path 'tmp/voicevox' $audioFilename
  Invoke-WebRequest -Uri $audioSource.url -OutFile $audioArchive
  $audioHash = (Get-FileHash -LiteralPath $audioArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($audioHash -ne $audioSource.sha256) { throw "SHA256 mismatch: $audioFilename" }
  if ($audioFilename.EndsWith('.zip')) {
    Expand-Archive -LiteralPath $audioArchive -DestinationPath 'tmp/voicevox' -Force
  } elseif ($audioFilename.EndsWith('.tgz') -or $audioFilename.EndsWith('.tar.gz')) {
    tar -xf $audioArchive -C 'tmp/voicevox'
  }
}
node tools/generate-audio.mjs --prepare-core-adapter
```

然后将核心服务隐藏启动，只监听本机 `127.0.0.1:50022`。桥接服务调用官方 C API；`/speakers` 返回模型的实际角色信息，生成工具按角色及风格名称选取，避免假定固定风格 ID。

```powershell
$audioRoot = (Resolve-Path '.').Path
$audioServer = Join-Path $audioRoot 'tmp/voicevox/core-server.py'
$audioCore = Join-Path $audioRoot 'tmp/voicevox'
$audioPython = (Get-Command python).Source
$audioProcess = Start-Process -FilePath $audioPython -ArgumentList @("`"$audioServer`"", "`"$audioCore`"", '50022') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $audioRoot 'tmp/voicevox/server.stdout.log') -RedirectStandardError (Join-Path $audioRoot 'tmp/voicevox/server.stderr.log')
```

待 `tmp/voicevox/server.stdout.log` 显示 `ready` 后生成并验证全部音频：

```powershell
node tools/generate-audio.mjs --engine-url http://127.0.0.1:50022
node --test tests/offline-audio.test.mjs
Stop-Process -Id $audioProcess.Id
```

相同输入、版本和设置可用于重建；不同平台或底层计算实现可能产生不同二进制波形，manifest 中的原始 WAV 哈希用于核对当前发行版。更新配方后须重新检查全部音素并进行试听。

官方项目：[VOICEVOX CORE](https://github.com/VOICEVOX/voicevox_core/releases/tag/0.17.0)、[VOICEVOX 音色模型](https://github.com/VOICEVOX/voicevox_vvm/releases/tag/0.17.0)。
