#!/usr/bin/env python3
"""Minimal GFM-subset markdown -> HTML for the NCTH report.
Handles: headings, paragraphs, GFM pipe tables, fenced code, inline code,
bold, links, images, hr, blockquotes, ordered/unordered lists."""
import re, sys, html as _html

def esc(s):
    return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def inline(text):
    # protect inline code spans
    codes=[]
    def stash(m):
        codes.append(esc(m.group(1)))
        return f'\x00{len(codes)-1}\x00'
    text=re.sub(r'`([^`]+)`', stash, text)
    text=esc(text)
    # images ![alt](src)
    text=re.sub(r'!\[([^\]]*)\]\(([^)]+)\)',
                r'<img src="\2" alt="\1" loading="lazy">', text)
    # links [text](url)
    text=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',
                r'<a href="\2">\1</a>', text)
    # bold **text**
    text=re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    # restore code
    text=re.sub(r'\x00(\d+)\x00', lambda m:f'<code>{codes[int(m.group(1))]}</code>', text)
    return text

def is_table_sep(line):
    s=line.strip()
    return bool(re.match(r'^\|?[\s:|-]+\|[\s:|-]*$', s)) and '-' in s

def cells(line):
    s=line.strip()
    if s.startswith('|'): s=s[1:]
    if s.endswith('|'): s=s[:-1]
    return [c.strip() for c in s.split('|')]

def convert(md):
    lines=md.split('\n')
    out=[]; i=0; n=len(lines)
    while i<n:
        line=lines[i]
        # fenced code
        if line.strip().startswith('```'):
            i+=1; buf=[]
            while i<n and not lines[i].strip().startswith('```'):
                buf.append(esc(lines[i])); i+=1
            i+=1
            out.append('<pre><code>'+'\n'.join(buf)+'</code></pre>')
            continue
        # blank
        if line.strip()=='':
            i+=1; continue
        # hr
        if re.match(r'^\s*(---+|\*\*\*+)\s*$', line):
            out.append('<hr>'); i+=1; continue
        # heading
        m=re.match(r'^(#{1,6})\s+(.*)$', line)
        if m:
            lvl=len(m.group(1))
            out.append(f'<h{lvl}>{inline(m.group(2).strip())}</h{lvl}>')
            i+=1; continue
        # table
        if '|' in line and i+1<n and is_table_sep(lines[i+1]):
            header=cells(line); i+=2
            body=[]
            while i<n and '|' in lines[i] and lines[i].strip():
                body.append(cells(lines[i])); i+=1
            t=['<div class="tw"><table>','<thead><tr>']
            for h in header: t.append(f'<th>{inline(h)}</th>')
            t.append('</tr></thead><tbody>')
            for row in body:
                t.append('<tr>')
                for c in row: t.append(f'<td>{inline(c)}</td>')
                # pad short rows
                for _ in range(len(header)-len(row)): t.append('<td></td>')
                t.append('</tr>')
            t.append('</tbody></table></div>')
            out.append('\n'.join(t))
            continue
        # blockquote
        if line.strip().startswith('>'):
            buf=[]
            while i<n and lines[i].strip().startswith('>'):
                buf.append(inline(re.sub(r'^\s*>\s?','',lines[i]))); i+=1
            out.append('<blockquote>'+'<br>'.join(buf)+'</blockquote>')
            continue
        # unordered list
        if re.match(r'^\s*[-*]\s+', line):
            buf=[]
            while i<n and re.match(r'^\s*[-*]\s+', lines[i]):
                buf.append('<li>'+inline(re.sub(r'^\s*[-*]\s+','',lines[i]))+'</li>'); i+=1
            out.append('<ul>'+''.join(buf)+'</ul>')
            continue
        # ordered list
        if re.match(r'^\s*\d+\.\s+', line):
            buf=[]
            while i<n and re.match(r'^\s*\d+\.\s+', lines[i]):
                buf.append('<li>'+inline(re.sub(r'^\s*\d+\.\s+','',lines[i]))+'</li>'); i+=1
            out.append('<ol>'+''.join(buf)+'</ol>')
            continue
        # paragraph (gather until blank / block start)
        buf=[line]; i+=1
        while i<n and lines[i].strip() and not re.match(r'^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s|>|\s*---+\s*$)', lines[i]) and not ('|' in lines[i] and i+1<n and is_table_sep(lines[i+1])):
            buf.append(lines[i]); i+=1
        out.append('<p>'+inline(' '.join(buf))+'</p>')
    return '\n'.join(out)

TEMPLATE='''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>NCTH Analysis &amp; Tuning Report</title>
<link rel="stylesheet" href="assets/style.css">
<script src="assets/ncth.js"></script>
<style>
:root{{--bg:#12151b;--panel:#1b202b;--ink:#e6ecf5;--mut:#93a1b5;--acc:#5cc8ff;--prop:#c58cff;--good:#54d98c;--bad:#ff6b6b;--warn:#ffcf5c}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}}
main{{max-width:1350px;margin:0 auto;padding:26px 22px 80px}}
h1{{font-size:26px;line-height:1.25;margin:24px 0 8px;letter-spacing:.2px}}
h2{{font-size:20px;margin:34px 0 10px;padding-top:12px;border-top:1px solid #262f40;color:#dfe8f5}}
h3{{font-size:16.5px;margin:22px 0 8px;color:var(--acc)}}
p{{margin:11px 0}}
a{{color:var(--acc)}}
code{{background:#0e1219;border:1px solid #2a3346;border-radius:4px;padding:1px 5px;color:#bfe3ff;font-size:.9em}}
pre{{background:#0e1219;border:1px solid #2a3346;border-radius:8px;padding:12px 14px;overflow:auto;line-height:1.4}}
pre code{{background:none;border:0;padding:0;color:#cfe3f5;font-size:12.5px;white-space:pre}}
.tw{{overflow-x:auto;margin:14px 0}}
table{{border-collapse:collapse;width:100%;font-size:13.5px}}
th,td{{border:1px solid #2c3444;padding:7px 10px;text-align:left;vertical-align:top}}
th{{background:#232a38;color:var(--mut);font-weight:600}}
tr:nth-child(even) td{{background:#171c26}}
blockquote{{margin:14px 0;padding:8px 16px;border-left:3px solid var(--warn);background:#1a1f2a;color:#cdd6e4;border-radius:0 8px 8px 0}}
img{{max-width:100%;height:auto;display:block;margin:16px 0;border:1px solid #2a3346;border-radius:8px}}
hr{{border:0;border-top:1px solid #262f40;margin:26px 0}}
ul,ol{{margin:11px 0;padding-left:24px}}
li{{margin:5px 0}}
strong{{color:#fff}}
</style></head><body>
<div id="nav"></div>
<div id="banner"></div>
<main>
{body}
</main>
<script>if(window.NCTH){{document.getElementById('nav').innerHTML=NCTH.nav('report.html');
const S=NCTH.load();
function showBan(){{document.getElementById('banner').innerHTML=NCTH.banner(S);NCTH.wireBannerReset(S,showBan);}}
showBan();}}</script>
</body></html>'''

md=open(sys.argv[1],encoding='utf-8').read()
open(sys.argv[2],'w',encoding='utf-8').write(TEMPLATE.format(body=convert(md)))
print("wrote",sys.argv[2])
