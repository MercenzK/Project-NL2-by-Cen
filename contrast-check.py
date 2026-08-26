#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ตรวจ contrast ของคู่สีทั้งหมดในเว็บ ตามเกณฑ์ WCAG 2.2

  ตัวอักษรปกติ           >= 4.5:1   (1.4.3 AA)
  กราฟิก/ขอบตัวควบคุม     >= 3.0:1   (1.4.11 non-text)
  เส้นคั่นที่เป็นการตกแต่ง  ไม่มีเกณฑ์บังคับ แต่ตั้งไว้ 1.3 ให้ยังมองเห็น

วิธีใช้:  python3 contrast-check.py
ค่าสีอ่านจาก :root และ html[data-theme="dark"] ใน app.css โดยตรง
ถ้าแก้โทเคนแล้วให้รันซ้ำก่อนอัปโหลด
"""
import io, re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
# สไตล์ถูกแยกออกมาเป็น app.css แล้ว (เดิมอยู่ใน <style> ของ index.html)
SRC  = os.path.join(HERE, 'app.css')

# ---------- คำนวณ contrast ratio ----------
def _lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lum(hexstr):
    h = hexstr.lstrip('#')
    if len(h) == 3:
        h = ''.join(ch * 2 for ch in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

# ---------- ดึงโทเคนจาก index.html ----------
def read_tokens():
    css = io.open(SRC, encoding='utf-8').read()

    def block(pattern):
        m = re.search(pattern + r'\{(.*?)\n\}', css, re.S)
        return dict(re.findall(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;', m.group(1))) if m else {}

    light = block(r':root\s*')
    dark  = dict(light)                       # โหมดมืดสืบทอดค่าที่ไม่ได้เขียนทับ
    dark.update(block(r'html\[data-theme="dark"\]\s*'))
    return light, dark

# ---------- คู่สีที่ต้องตรวจ ----------
TEXT = [
    ('เนื้อความหลัก',      '--ink',    ['--bg', '--paper', '--sunken', '--hover']),
    ('ข้อความรอง',         '--ink-2',  ['--bg', '--paper', '--sunken']),
    ('ป้ายกำกับ / meta',   '--ink-3',  ['--bg', '--paper', '--sunken', '--hover']),
    ('ลิงก์ / สีเน้น',      '--accent', ['--bg', '--paper', '--sunken', '--accent-w']),
    ('ถูกต้อง',            '--ok',     ['--paper', '--ok-w']),
    ('ผิด',                '--no',     ['--paper', '--no-w']),
    ('เตือน',              '--warn',   ['--paper', '--warn-w']),
    ('ตัวอักษรบนปุ่มหลัก',  '--on-accent', ['--accent']),
]
GRAPHIC = [
    ('ขอบของสิ่งที่กดได้',  '--line-2', ['--paper', '--bg', '--sunken']),
    ('รูปดาว (กราฟิก)',     '--star-d', ['--paper', '--sunken', '--warn-w']),
]
DECOR = [
    ('เส้นคั่น (ตกแต่ง)',   '--line',   ['--paper', '--bg', '--sunken']),
]

def run():
    light, dark = read_tokens()
    fails = 0
    for label, T in (('สว่าง', light), ('มืด', dark)):
        print('\n══ โหมด%s ══' % label)
        for group, need in ((TEXT, 4.5), (GRAPHIC, 3.0), (DECOR, 1.3)):
            for name, fg, bgs in group:
                if fg not in T:
                    print('   %-22s !! ไม่พบโทเคน %s' % (name, fg)); fails += 1; continue
                cells = []
                for bg in bgs:
                    if bg not in T:
                        cells.append('%s ?' % bg); continue
                    r = ratio(T[fg], T[bg])
                    ok = r >= need
                    if not ok: fails += 1
                    cells.append('%s %.2f%s' % (bg.replace('--', ''), r, '' if ok else ' ✗'))
                print('   %-22s %-52s (เกณฑ์ %.1f)' % (name, ' | '.join(cells), need))
    print('\nสรุป: %s' % ('ผ่านทั้งหมด' if not fails else 'ตกเกณฑ์ %d คู่' % fails))
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(run())
