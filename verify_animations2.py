from playwright.sync_api import sync_playwright
import time
import os

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('http://127.0.0.1:8080')

    # Wait for initial load and animations to stabilize
    time.sleep(3)

    # Scroll slightly to trigger reveals
    page.evaluate('window.scrollTo(0, 500)')
    time.sleep(1)

    # Trigger a hover
    projects = page.locator('.portfolio-card')
    if projects.count() > 0:
        projects.first.hover()
        time.sleep(0.5)

    os.makedirs('/home/jules/verification', exist_ok=True)
    page.screenshot(path='/home/jules/verification/verification_2.png', full_page=True)
    browser.close()
