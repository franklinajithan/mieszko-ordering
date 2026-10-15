"""Configurable Playwright CRM flow; selectors must be captured on the office CRM.
Only exports reports. Does not book deliveries or edit CRM records.
"""
import argparse
import json
import os
from pathlib import Path


def download(config_path, source, start, end, output):
    from playwright.sync_api import sync_playwright
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    steps = config['reports'][source]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=config.get('headless', True), executable_path=config.get('browser_executable'), args=config.get('browser_args'))
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(config.get('timeout_ms', 1200000))
        page.goto(config['url'])
        values = {'start': start, 'end': end}
        pages = {'main': page}
        for step in config.get('login_steps', []) + steps:
            active_page = pages[step.get('page', 'main')]
            scope = active_page.frame_locator(step['frame']) if step.get('frame') else active_page
            target = scope.locator(step['selector'])
            action = step['action']
            if action == 'fill':
                value = os.environ[step['env']] if 'env' in step else step['value'].format(**values)
                target.fill(value)
            elif action == 'click':
                target.click()
            elif action == 'check':
                target.set_checked(step['checked'])
            elif action == 'select':
                target.select_option(step['value'].format(**values))
            elif action == 'wait':
                target.wait_for(state='visible')
            elif action == 'popup':
                with active_page.expect_popup() as event:
                    target.click()
                pages[step['name']] = event.value
                pages[step['name']].set_default_timeout(config.get('timeout_ms', 1200000))
            elif action == 'download':
                with active_page.expect_download() as event:
                    target.click()
                artifact = event.value
                if artifact.failure():
                    raise RuntimeError('CRM report download failed')
                artifact.save_as(output)
            else:
                raise ValueError('Unsupported CRM action')
        browser.close()
    if not Path(output).is_file():
        raise ValueError('CRM flow did not download a report')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('config', 'source', 'start', 'end', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    download(args.config, args.source, args.start, args.end, args.output)
