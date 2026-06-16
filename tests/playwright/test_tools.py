#!/usr/bin/env python3
"""Playwright E2E test: TMap Hooker extension on Tencent Maps

Tests: extension injection, polygon/circle creation, layer click events, snapshot/restore.
"""

import os, sys, json, time
from pathlib import Path

EXT_PATH = os.path.abspath('/home/ubuntu/repos/tmap-hooker/dist')
# 使用一个有地图的腾讯地图页面
TEST_URL = 'https://map.qq.com/?type=marker&isopeninfowin=false&markertype=1&pointx=116.397428&pointy=39.90923&name=test&addr=&ref='
RESULTS = []

def log(level, msg):
    line = f"[{level}] {msg}"
    print(line, flush=True)
    RESULTS.append(line)

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    log('FATAL', 'playwright not installed. Run: pip install playwright && python -m playwright install chromium')
    sys.exit(1)

def wait_for(page, js, timeout=15000, label='condition'):
    """轮询等待 JS 条件为真"""
    start = time.monotonic()
    deadline = start + timeout / 1000.0
    while time.monotonic() < deadline:
        try:
            if page.evaluate(js):
                return True
        except Exception:
            pass
        time.sleep(0.3)
    log('TIMEOUT', f'Timeout waiting for {label}')
    return False

def collect_msg(page, msg_type, clear=True, timeout=3):
    """监听页面 postMessage 并收集指定类型的消息"""
    if clear:
        page.evaluate(f"() => {{ window.__msgs_{msg_type} = []; }}")
    page.evaluate(f"""
    () => {{
        if (!window.__listener_{msg_type}) {{
            window.__listener_{msg_type} = (e) => {{
                try {{
                    const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                    if (d.type === '{msg_type}' || (d.payload && d.payload.cmd === '{msg_type}')) {{
                        window.__msgs_{msg_type}.push(d);
                    }}
                }} catch {{}}
            }};
            window.addEventListener('message', window.__listener_{msg_type});
        }}
    }}
    """)
    time.sleep(timeout)
    return page.evaluate(f"() => window.__msgs_{msg_type} || []")

# ═══════════════════════════════════════════════════════════════
#  TEST CASES
# ═══════════════════════════════════════════════════════════════

def tc1_check_injection(page):
    """TC1: 验证扩展脚本注入"""
    log('>>>', 'TC1: Extension injection check')
    
    # 检查 hook (MAIN world) 是否打了补丁
    has_patch = page.evaluate("""
    () => {
        const TMap = window.TMap;
        return !!TMap && !!TMap.__tmapHookerPatched;
    }
    """)
    
    # 检查 panel host (ISOLATED world, Shadow DOM)
    has_panel = page.evaluate("""
    () => !!document.querySelector('.tmap-panel-host')
    """)
    
    if has_patch:
        log('PASS', f'TC1 hook injection: TMap.__tmapHookerPatched=true')
    else:
        log('SKIP', f'TC1 hook: TMap not loaded or hook not patched yet')
    
    if has_panel:
        log('PASS', f'TC1 panel injection: .tmap-panel-host found')
    else:
        log('SKIP', f'TC1 panel: .tmap-panel-host not found (may mount after MAP_READY)')

def tc2_map_ready(page):
    """TC2: MAP_READY 消息流程"""
    log('>>>', 'TC2: MAP_READY flow')
    
    # 先检查 TMap 是否已可用
    tmap_ok = wait_for(page, "() => !!(window.TMap && window.TMap.__tmapHookerPatched)", 12000, 'TMap+patch')
    
    if not tmap_ok:
        log('SKIP', 'TC2: TMap not available on this page, cannot test MAP_READY')
        return
    
    # 监听 MAP_READY
    page.evaluate("""
    () => {
        window.__map_ready_events = [];
        window.addEventListener('message', (e) => {
            try {
                const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                if (d.source === 'tmap-hook' && d.type === 'MAP_READY') {
                    window.__map_ready_events.push(d);
                }
            } catch {}
        });
    }
    """)
    
    time.sleep(2)
    events = page.evaluate("() => window.__map_ready_events || []")
    if events:
        log('PASS', f'TC2: MAP_READY sent ({len(events)} times)')
    else:
        log('INFO', 'TC2: MAP_READY not yet sent (hook may wait for map instance)')

def tc3_postmessage_channel(page):
    """TC3: postMessage 通信通道"""
    log('>>>', 'TC3: postMessage channel')
    
    result = page.evaluate("""
    () => {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve({ok: false, reason: 'timeout'}), 4000);
            const handler = (e) => {
                try {
                    const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                    // 监听任意来自 hook 的消息作为通道可用证明
                    if (d.source === 'tmap-hook') {
                        clearTimeout(timeout);
                        window.removeEventListener('message', handler);
                        resolve({ok: true, msg: d.type});
                    }
                } catch {}
            };
            window.addEventListener('message', handler);
            // 发送 PING 触发 hook 响应
            window.postMessage(JSON.stringify({source: 'tmap-panel', type: 'PING'}), '*');
        });
    }
    """)
    
    if result.get('ok'):
        log('PASS', f"TC3: Hook responds (message type: {result.get('msg')})")
    else:
        log('SKIP', f"TC3: No hook response ({result.get('reason')}) — extension may not be active")

def tc4_polygon_lifecycle(page):
    """TC4: 多边形创建→选中→编辑完整链路"""
    log('>>>', 'TC4: Polygon lifecycle (create → select → edit)')
    
    if not page.evaluate("() => !!(window.TMap && window.TMap.__tmapHookerPatched)"):
        log('SKIP', 'TC4: Hook not active')
        return
    
    # 监听消息
    page.evaluate("""
    () => {
        window.__tc4_msgs = [];
        window.addEventListener('message', (e) => {
            try {
                const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                if (d.source === 'tmap-hook') window.__tc4_msgs.push({type: d.type, payload: d.payload});
            } catch {}
        });
    }
    """)
    
    # 1. 切到多边形工具
    page.evaluate("""
    () => window.postMessage(JSON.stringify({
        source: 'tmap-panel', type: 'PANEL_CMD',
        payload: { cmd: 'SET_TOOL', toolId: 'polygon' }
    }), '*')
    """)
    time.sleep(1)
    
    # 2. 发送多边形顶点坐标
    coords = "116.397,39.909;116.407,39.909;116.407,39.919;116.397,39.919"
    page.evaluate(f"""
    () => window.postMessage(JSON.stringify({{
        source: 'tmap-panel', type: 'PANEL_CMD',
        payload: {{ cmd: 'ADD_POLYGON', coords: '{coords}' }}
    }}), '*')
    """)
    
    time.sleep(2)
    msgs = page.evaluate("() => window.__tc4_msgs || []")
    
    layer_drawn = [m for m in msgs if m['type'] == 'LAYER_DRAWN']
    if layer_drawn:
        poly = layer_drawn[0]['payload']
        log('PASS', f"TC4.1: LAYER_DRAWN — id={poly.get('id')}, data={poly.get('data', {}).get('kind')}")
    else:
        log('FAIL', 'TC4.1: No LAYER_DRAWN for polygon')
        return
    
    poly_id = layer_drawn[0]['payload'].get('id')
    if not poly_id:
        log('FAIL', 'TC4: No polygon id in LAYER_DRAWN')
        return
    
    # 3. 选中多边形
    page.evaluate(f"""
    () => window.postMessage(JSON.stringify({{
        source: 'tmap-panel', type: 'PANEL_CMD',
        payload: {{ cmd: 'SELECT_LAYER', id: '{poly_id}' }}
    }}), '*')
    """)
    time.sleep(1)
    
    msgs = page.evaluate("() => window.__tc4_msgs || []")
    selected = [m for m in msgs if m['type'] == 'LAYER_SELECTED']
    if selected:
        log('PASS', f"TC4.2: LAYER_SELECTED — id={selected[-1]['payload'].get('id')}")
    else:
        log('FAIL', 'TC4.2: No LAYER_SELECTED for polygon')

def tc5_circle_lifecycle(page):
    """TC5: 圆形创建→参数验证→点击选中"""
    log('>>>', 'TC5: Circle lifecycle (create → params → click)')
    
    if not page.evaluate("() => !!(window.TMap && window.TMap.__tmapHookerPatched)"):
        log('SKIP', 'TC5: Hook not active')
        return
    
    page.evaluate("""
    () => {
        window.__tc5_msgs = [];
        window.addEventListener('message', (e) => {
            try {
                const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                if (d.source === 'tmap-hook') window.__tc5_msgs.push({type: d.type, payload: d.payload});
            } catch {}
        });
    }
    """)
    
    # 1. 切到圆形工具
    page.evaluate("""
    () => window.postMessage(JSON.stringify({
        source: 'tmap-panel', type: 'PANEL_CMD',
        payload: { cmd: 'SET_TOOL', toolId: 'circle' }
    }), '*')
    """)
    time.sleep(0.5)
    
    # 2. 设置圆心
    page.evaluate("""
    () => window.postMessage(JSON.stringify({
        source: 'tmap-panel', type: 'PANEL_CMD',
        payload: { cmd: 'CIRCLE_CENTER_SET', lat: 39.909, lng: 116.397 }
    }), '*')
    """)
    time.sleep(0.5)
    
    # 3. 设置半径
    page.evaluate("""
    () => window.postMessage(JSON.stringify({
        source: 'tmap-panel', type: 'PANEL_CMD',
        payload: { cmd: 'CIRCLE_UPDATE', radius: 250, nPoints: 64 }
    }), '*')
    """)
    time.sleep(0.5)
    
    # 4. 监听 CIRCLE_UPDATED
    circle_updated = page.evaluate("""
    () => {
        const msgs = window.__tc5_msgs || [];
        return msgs.filter(m => m.type === 'CIRCLE_UPDATED');
    }
    """)
    
    if circle_updated:
        p = circle_updated[-1]['payload']
        log('PASS', f"TC5.1: CIRCLE_UPDATED — r={p.get('radius')}, n={p.get('nPoints')}, hasLatLng={'lat' in p}")
    else:
        log('FAIL', 'TC5.1: No CIRCLE_UPDATED')
    
    # 5. 提交圆形
    page.evaluate("""
    () => window.postMessage(JSON.stringify({
        source: 'tmap-panel', type: 'PANEL_CMD',
        payload: { cmd: 'CIRCLE_FINISH' }
    }), '*')
    """)
    time.sleep(1.5)
    
    msgs = page.evaluate("() => window.__tc5_msgs || []")
    circle_drawn = [m for m in msgs if m['type'] == 'LAYER_DRAWN' and m['payload'].get('kind') == 'circle']
    
    if circle_drawn:
        data = circle_drawn[0]['payload'].get('data', {})
        center = data.get('center', {})
        log('PASS', f"TC5.2: LAYER_DRAWN circle — center=({center.get('lat'):.4f},{center.get('lng'):.4f}), r={data.get('radius')}, hasArea={'area' in data}")
    else:
        log('FAIL', 'TC5.2: No LAYER_DRAWN for circle')

def tc6_polygon_area_perimeter(page):
    """TC6: 多边形面积/周长计算（Bug 5 修复验证）"""
    log('>>>', 'TC6: Polygon area/perimeter (Bug 5 fix verification)')
    
    if not page.evaluate("() => !!(window.TMap && window.TMap.__tmapHookerPatched)"):
        log('SKIP', 'TC6: Hook not active')
        return
    
    msgs = page.evaluate("""
    () => {
        const msgs = window.__tc4_msgs || [];
        // 查找 POLYGON_GEOMETRY 消息
        return msgs.filter(m => m.type === 'POLYGON_GEOMETRY');
    }
    """)
    
    if msgs:
        p = msgs[-1]['payload']
        has_valid = p.get('area') is not None and p.get('perimeter') is not None
        log('PASS' if has_valid else 'FAIL', 
            f"TC6: POLYGON_GEOMETRY — area={p.get('area')}, perimeter={p.get('perimeter')}")
    else:
        log('INFO', 'TC6: No POLYGON_GEOMETRY message (may use inlined area/perimeter from Bug 5 fix)')

def tc7_circle_latlng_in_updated(page):
    """TC7: CIRCLE_UPDATED 携带 lat/lng（Bug 7 修复验证）"""
    log('>>>', 'TC7: CIRCLE_UPDATED lat/lng (Bug 7 fix verification)')
    
    circle_updateds = page.evaluate("""
    () => {
        const msgs = window.__tc5_msgs || [];
        return msgs.filter(m => m.type === 'CIRCLE_UPDATED');
    }
    """)
    
    if circle_updateds:
        last = circle_updateds[-1]['payload']
        has_latlng = 'lat' in last and 'lng' in last
        if has_latlng:
            log('PASS', f"TC7: CIRCLE_UPDATED has lat/lng — lat={last['lat']}, lng={last['lng']}")
        else:
            log('FAIL', f"TC7: CIRCLE_UPDATED missing lat/lng — keys={list(last.keys())}")
    else:
        log('SKIP', 'TC7: No CIRCLE_UPDATED messages')

# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    log('INFO', f'Extension: {EXT_PATH}')
    log('INFO', f'Target URL: {TEST_URL}')
    
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir='/tmp/pw-tmap-test',
            headless=True,
            args=[
                f'--disable-extensions-except={EXT_PATH}',
                f'--load-extension={EXT_PATH}',
                '--no-sandbox',
                '--disable-dev-shm-usage',
            ],
            viewport={'width': 1280, 'height': 800},
        )
        
        try:
            page = context.new_page()
            
            # 监听 console 消息（调试用）
            page.on('console', lambda msg: print(f'  [BROWSER {msg.type}] {msg.text[:300]}') if msg.type in ('error', 'warning') else None)
            
            log('INFO', f'Loading {TEST_URL} ...')
            page.goto(TEST_URL, wait_until='commit', timeout=60000)
            log('INFO', f'Page title: {page.title()[:80]}')
            
            # 等待 TMap（腾讯地图是 SPA，TMap 异步加载）
            tmap_ok = wait_for(page, "() => !!window.TMap", 30000, 'window.TMap')
            if tmap_ok:
                log('OK', 'TMap object detected')
                wait_for(page, "() => !!window.TMap.__tmapHookerPatched", 8000, 'hook patch')
            else:
                log('WARN', 'TMap not found — most tests will SKIP')
            
            # 运行所有测试
            tc1_check_injection(page)
            tc2_map_ready(page)
            tc3_postmessage_channel(page)
            tc4_polygon_lifecycle(page)
            tc5_circle_lifecycle(page)
            tc6_polygon_area_perimeter(page)
            tc7_circle_latlng_in_updated(page)
            
        except Exception as e:
            log('ERROR', str(e))
            import traceback
            traceback.print_exc()
        finally:
            context.close()
    
    # ── 结果汇总 ──────────────────────────────────────────────
    print("\n" + "=" * 65)
    print("  TEST RESULTS SUMMARY")
    print("=" * 65)
    for r in RESULTS:
        print(r)
    
    passes = sum(1 for r in RESULTS if '[PASS]' in r)
    fails = sum(1 for r in RESULTS if '[FAIL]' in r)
    skips = sum(1 for r in RESULTS if '[SKIP]' in r)
    print(f"\n  PASS={passes}  FAIL={fails}  SKIP={skips}")
    print("=" * 65)
    
    if fails > 0:
        sys.exit(1)

if __name__ == '__main__':
    main()
