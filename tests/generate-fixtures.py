"""Build real Python Markdown HTML fixtures, with no browser-side parser substitute.

Writes tests/fixtures/rendered.json, which the browser regression compares against.
Re-run this after ANY change to the renderer that alters its HTML output, otherwise
the browser tests keep comparing against stale output and pass without meaning it.

    .venv/Scripts/python.exe tests/generate-fixtures.py

Paths are resolved from this file, not from the working directory.
"""
from pathlib import Path
import json
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'python'))
from znote_renderer import render

samples = {
    'admonition': '!!! note "提示"\n\n    中文 **粗体** 内容。\n',
    'details': '??? note "展开查看"\n\n    第一段详细内容。\n\n    第二段详细内容。\n\n    第三段详细内容。\n',
    'tabs': '=== "第一项"\n\n    短内容。\n\n=== "第二项"\n\n    第一段长内容。\n\n    第二段长内容。\n\n    第三段长内容。\n',
    'table': '| 名称 | 数值 |\n| --- | --- |\n| 中文 | **12** |\n',
    'code': '```python\ndef greet(name):\n    return "你好 " + name\n```\n',
    'numbered_code': '```python title="hello.py" linenums="1"\ndef hello():\n    print("你好，ZNote")\n```\n',
    'quote': '> 引用 **粗体**。\n>\n> 第二段内容。\n',
    'rule': '---',
    'setext': '下划线标题\n----------',
    'math': '$$\nE=mc^2\n$$\n',
    'image': '![diagram](data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"%20width="300"%20height="100"/%3E)',
    'regressions': '# 渲染验证\n\n```mermaid\ngraph LR\n A[Start] --> B{Error?}\n B -->|Yes| C[Debug]\n B -->|No| D[Done]\n```\n\n```python linenums="1"\n' + '\n'.join(f'value_{i} = {i}' for i in range(1, 21)) + '\n```\n\n脚注[^note]\n\n[^note]: 悬浮可以读取这段中文脚注。\n\n:material-home: :fontawesome-brands-github: :octicons-mark-github-16:\n\n<div style="color: rgb(90, 110, 130)">内联样式</div>\n\n<style>.local-style { font-weight: 700; }</style>\n\n<div class="local-style">样式块</div>',
}
rich = '# 一级标题 Heading\n\n正文 **粗体**、*斜体*、`inline code`、[链接](https://zensical.org/)、==标记==。\n\n## 二级标题\n\n### 三级标题\n\n> 引用段落\n\n- 列表项目\n- 第二项\n\n有序列表：\n\n1. 有序项目\n\n- [x] 已完成\n- [ ] 待办\n\n---\n\n' + '\n'.join(value for key, value in samples.items() if key != 'regressions')
samples['rich']=rich
samples['frontmatter']='---\ntitle: 属性\n---'
samples['callouts'] = '''# Callouts

> [!NOTE]
> GitHub note.

> [!TIP]
> GitHub tip.

> [!IMPORTANT]
> GitHub important.

> [!WARNING]
> GitHub warning.

> [!CAUTION]
> GitHub caution.

> [!tip]+ 展开的 **标题**
> 展开的正文。

> [!warning]- 收起的提示
> 收起的正文。

> [!note] 外层提示
> 重复段落。
>
> > [!tip] 内层提示
> > 重复段落。
>
> 重复段落。

> [!example] 代码与列表
> - 列表项目
>
> ```python
> print("Callout")
> ```

> 第一段普通引用

> 第二段普通引用
'''
samples['sync_callouts'] = ('---\ntitle: Sync 😀\ndescription: |\n'
    + '\n'.join(f'  Property {i}' for i in range(45)) + '\n---\n\n'
    + '\n\n'.join(f'Before {i}' for i in range(40)) + '\n\n'
    + samples['callouts'] + '\n'
    + '\n\n'.join(f'After {i}' for i in range(40)))
# Identical metadata and body exercise the preview's unchanged-HTML fast path.
samples['sync_callouts_updated'] = samples['sync_callouts'].replace('---\n', '---\n\n', 1)
results={key:render({'text':text, 'settings': {'primary': 'indigo', 'accent': 'indigo'} if key == 'rich' else {}}) for key, text in samples.items()}
fixtures=Path(__file__).resolve().parent/'fixtures'
fixtures.mkdir(exist_ok=True)
(fixtures/'rendered.json').write_text(json.dumps({'samples':samples,'results':results},ensure_ascii=False,indent=2),encoding='utf-8')
