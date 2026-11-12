# Third-party notices

Rook's own code is licensed as described in `LICENSE`. This file credits work that shaped parts
of the Store's catalogs and work that Rook includes. Where text was copied or adapted it says so;
where only ideas or structure were used it says that instead.

## Included code and data

### Open Bot Avatar

The characters an agent can wear (the ghost, the cat, the rocket and the rest) and the code that
draws and animates them come from Open Bot Avatar, version 0.1.2
(https://github.com/DominikScholz/open-bot-avatar), by Dominik Scholz, under the MIT License.
The `open-bot-avatar` package is a dependency of `@corvo/ui-web`. The definitions of the 22
characters (the project's starter avatars and its gallery, geometry only) are copied unchanged
into `packages/ui-web/src/bot-characters.ts`. The rook and the chess pieces (king, queen,
bishop, knight, pawn) are Rook's own drawings in the same format, not copied from the project.

```text
MIT License

Copyright (c) 2026 Dominik Scholz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Speech models on the owner's computer

The desktop app can listen and speak with models that run on the owner's own computer. None of
them is part of Rook's source or its installers: each one is downloaded when the owner asks for
it, or the first time a conversation needs it, from the sherpa-onnx project's releases
(https://github.com/k2-fsa/sherpa-onnx/releases) over HTTPS, and checked against a digest pinned
in `packages/adapters/src/local-speech-models.ts` and `local-voices.ts`. The engine that runs them,
sherpa-onnx, is licensed under Apache-2.0.

| Model | What it does | License | Source |
|---|---|---|---|
| Whisper base, small | Turns speech into text, in many languages | MIT | OpenAI Whisper |
| Português (Brasil) | Voice | BSD-3-Clause | Coqui TTS VITS model `pt/cv/vits`, by NeonGeckoCom |
| Español | Voice | BSD-3-Clause | Coqui TTS VITS model `es/css10/vits`, by NeonGeckoCom |
| Français | Voice | BSD-3-Clause | Coqui TTS VITS model `fr/css10/vits`, by NeonGeckoCom |
| Deutsch | Voice | BSD-3-Clause | Coqui TTS VITS model `de/css10/vits`, by NeonGeckoCom |
| Kokoro (English) | Voice | Apache-2.0 | Kokoro-82M, by hexgrad, as packaged by sherpa-onnx |

Only models whose license allows use and redistribution in a product are offered. Piper voices
are not: they need the espeak-ng phonemizer, which is licensed under GPL-3.0 and which sherpa-onnx
2.x no longer includes, and several Piper voices carry non-commercial dataset licenses. A voice is
added to the list only after its license is checked and recorded here.

## Agent and skill catalogs

The Store's agents and skills are written for Rook, in English and Portuguese, and adapted to the
way small businesses in Brazil work. No text was copied from the sources below unless a line under
"Adapted from" says so for that item. The sources are credited because their structure and
ideas helped.

### Ideas and structure

- Anthropic, `knowledge-work-plugins` (Apache License 2.0):
  https://github.com/anthropics/knowledge-work-plugins. The finance, small-business, marketing,
  design and operations plugins showed which jobs a small business wants an agent to do and how
  a skill can be laid out as steps with approval gates.

### Adapted from

Nothing yet. A skill or agent that adapts third-party text will be listed here with its source,
the license, and a note of what was changed, and the license text will be kept with it.

## Not used

The catalogs of OpenBot (`nightly-labs/openbot`) are licensed under the PolyForm Noncommercial
License 1.0.0, which does not allow commercial use. Nothing from them is used, except for the
`pstack` bundle, which carries its own MIT license (Lauren Tan) and is not included yet.
