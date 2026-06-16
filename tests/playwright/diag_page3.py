#!/usr/bin/env python3
"""诊断3：等待更长时间并检查所有 maps 相关的全局变量"""
import os, time, sys, json
from playwright.sync_api import sync_playwright

EXT_PATH = os.path.abspath('/home/ubuntu/repos/tmap-hooker/dist')

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        user_data_dir='/tmp/pw-tmap-diag4',
        headless=True,
        args=[
            f'--disable-extensions-except={EXT_PATH}',
            f'--load-extension={EXT_PATH}',
            '--no-sandbox', '--disable-dev-shm-usage',
        ],
        viewport={'width': 1280, 'height': 800},
    )
    
    page = context.new_page()
    page.goto('https://map.qq.com/', wait_until='commit', timeout=30000)
    print(f"Title: {page.title()}")
    
    # 轮询等待 TMap（最多 40 秒）
    for i in range(40):
        time.sleep(1)
        tmap_type = page.evaluate("() => typeof window.TMap")
        qqmap_type = page.evaluate("() => typeof window.qq?.maps")
        if tmap_type != 'undefined':
            print(f"[{i}s] TMap found! type={tmap_type}")
            break
        if i % 5 == 0:
            print(f"[{i}s] TMap={tmap_type}, qq.maps={qqmap_type}")
    else:
        print(f"[40s] TMap still undefined")
    
    # 最终检查
    result = page.evaluate("""
    () => {
        return {
            TMap: typeof window.TMap,
            'qq.maps': typeof window.qq?.maps,
            'qq.maps.Map': typeof window.qq?.maps?.Map,
            'qq.maps.LatLng': typeof window.qq?.maps?.LatLng,
            'qq.maps.geometry': typeof window.qq?.maps?.geometry,
            QQMap: typeof window.QQMap,
            // 检查是否有任何 Map 实例
            mapElements: document.querySelectorAll('[id*="map"], [class*="map"], canvas').length,
        };
    }
    """)
    print(f"\nFinal state:\n{json.dumps(result, ensure_ascii=False, indent=2)}")
    
    context.close()
