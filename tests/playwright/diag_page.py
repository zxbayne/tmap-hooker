#!/usr/bin/env python3
"""诊断脚本：检查腾讯地图页面上可用的对象"""
import os, time, sys, json
from playwright.sync_api import sync_playwright

EXT_PATH = os.path.abspath('/home/ubuntu/repos/tmap-hooker/dist')

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        user_data_dir='/tmp/pw-tmap-diag2',
        headless=True,
        args=[
            f'--disable-extensions-except={EXT_PATH}',
            f'--load-extension={EXT_PATH}',
            '--no-sandbox',
            '--disable-dev-shm-usage',
        ],
        viewport={'width': 1280, 'height': 800},
    )
    
    page = context.new_page()
    page.on('console', lambda msg: print(f'  [BROWSER {msg.type}] {msg.text[:300]}'))
    
    print("Loading page...")
    try:
        page.goto('https://map.qq.com/', wait_until='commit', timeout=30000)
    except Exception as e:
        print(f"Goto error: {e}")
    
    print(f"Title: {page.title()}")
    
    # 等待一段时间让 JS 加载
    print("Waiting 20s for JS to load...")
    time.sleep(20)
    
    # 检查所有 window 上的属性
    result = page.evaluate("""
    () => {
        const keys = Object.keys(window).filter(k => {
            const v = window[k];
            return typeof v === 'object' || typeof v === 'function';
        });
        // 找 TMap 相关
        const tmapKeys = keys.filter(k => k.toLowerCase().includes('map') || k.toLowerCase().includes('tmap'));
        // 找 QQ 相关
        const qqKeys = keys.filter(k => k.toLowerCase().includes('qq') || k.toLowerCase().includes('tencent'));
        return {
            totalKeys: keys.length,
            tmapRelated: tmapKeys,
            qqRelated: qqKeys,
            hasTMap: !!window.TMap,
            TMapType: typeof window.TMap,
        };
    }
    """)
    print(f"Window stats: {json.dumps(result, ensure_ascii=False, indent=2)}")
    
    # 检查 script 标签
    scripts = page.evaluate("""
    () => {
        return Array.from(document.querySelectorAll('script[src]')).map(s => s.src).filter(s => s.includes('map') || s.includes('tmap') || s.includes('qq'));
    }
    """)
    print(f"Script tags with map/tmap/qq: {scripts[:10]}")
    
    context.close()
