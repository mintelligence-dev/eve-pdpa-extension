# One-off helper: pull the JSON a template-writing agent returned out of its
# transcript and save it, validated, under bench/templates/. Prints counts only.
import json, re, sys
src, dst = sys.argv[1], sys.argv[2]
found = None
def walk(x):
    global found
    if isinstance(x, str):
        i = x.find('{"business"')
        if i < 0:
            m = re.search(r'\{\s*"business"', x)
            i = m.start() if m else -1
        if i >= 0:
            j = x.rfind('}')
            try:
                obj = json.loads(x[i:j+1])
                if 'conversations' in obj: found = obj
            except Exception:
                pass
    elif isinstance(x, dict):
        for v in x.values(): walk(v)
    elif isinstance(x, list):
        for v in x: walk(v)
for line in open(src, encoding='utf-8'):
    try: walk(json.loads(line))
    except Exception: pass
if found is None: sys.exit('no template JSON found')
good = [c for c in found['conversations'] if isinstance(c.get('turns'), list) and c['turns']]
dropped = [c.get('id') for c in found['conversations'] if c not in good]
found['conversations'] = good
json.dump(found, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
if dropped: print('dropped malformed:', dropped)
convs = good
cust = [t for c in convs for t in c['turns'] if t['from'] == 'customer']
print(found['business'], '· conversations', len(convs), '· customer msgs', len(cust))
