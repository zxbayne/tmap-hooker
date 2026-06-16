#!/usr/bin/env python3
"""诊断2：检查 qq.maps / QQMap 的结构"""
import os, time, sys, json
from playwright.sync_api import sync_playwright

EXT_PATH = os.path.abspath('/home/ubuntu/repos/tmap-hooker/dist')

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        user_data_dir='/tmp/pw-tmap-diag3',
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
    print("Waiting 25s for JS to load...")
    time.sleep(25)
    
    result = page.evaluate("""
    () => {
        const info = {};
        
        // 检查 TMap
        info.TMap = typeof window.TMap;
        
        // 检查 qq.maps
        if (window.qq && window.qq.maps) {
            const maps = window.qq.maps;
            info.qqMaps = {
                hasMap: !!maps.Map,
                hasLatLng: !!maps.LatLng,
                hasEvent: !!maps.event,
                hasGeometry: !!maps.geometry,
                hasDrawing: !!maps.drawing,
                keys: Object.keys(maps).slice(0, 30),
            };
        } else {
            info.qqMaps = null;
        }
        
        // 检查 QQMap
        info.QQMap = typeof window.QQMap;
        if (window.QQMap) {
            info.QQMapType = typeof window.QQMap;
            info.QQMapKeys = Object.keys(window.QQMap).slice(0, 20);
        }
        
        // 检查 QQMapLoader
        info.QQMapLoader = typeof window.QQMapLoader;
        
        // 检查是否有 map 实例
        info.mapInstances = [];
        if (window.QQMap && window.QQMap._map) {
            info.mapInstances.push('QQMap._map');
        }
        
        return info;
    }
    """)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    context.close()
