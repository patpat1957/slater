from playwright.sync_api import sync_playwright
import sys

BASE = 'http://localhost:3001/lotto-scoreboard.html'
passed = 0
failed = 0
issues = []

def log(name, ok, detail=''):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        msg = f"  ❌ {name}" + (f" — {detail}" if detail else "")
        print(msg)
        issues.append({'name': name, 'detail': detail})

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(BASE, wait_until='networkidle', timeout=20000)
        print('\n=== SCOREBOARD COMPREHENSIVE TESTS ===\n')

        print('1. PAGE LOAD')
        log('Page title set', 'Lotto' in page.title())

        print('\n2. PICK 3 — Demo Data Load (3/19/2026 Evening)')
        p3_eve = page.evaluate("!!document.querySelector('#panel-pick3 .draw-tab:nth-child(2).active')")
        log('Pick 3 Evening tab active on load', p3_eve)
        log('Pick 3 confirmed count = 12', page.locator('#p3-s-draws').text_content().strip() == '12')
        log('Pick 3 partial count = 0', page.locator('#p3-s-partial').text_content().strip() == '0')
        log('Pick 3 pending count = 0', page.locator('#p3-s-pending').text_content().strip() == '0')
        log('Pick 3 scoreboard shows 12 rows', page.locator('#p3-tbody tr').count() == 12)
        log('Pick 3 hot tile populated', page.locator('#p3-s-hot').text_content().strip() != '—')
        log('Pick 3 cold tile populated', page.locator('#p3-s-cold').text_content().strip() != '—')
        log('Pick 3 freq table rendered', page.locator('#p3-freq table').count() > 0)
        log('Pick 3 position maps rendered', page.locator('#p3-posmaps .pos-map').count() > 0)
        log('Pick 3 Optimizer rendered', page.locator('#p3-picks .opt-panel').count() > 0)
        log('Pick 3 snapshot rendered', page.locator('#p3-snapshot .card-sm').count() > 0)

        print('\n3. PICK 3 — Status Filters')
        page.locator('#panel-pick3 .sf-confirmed').click(); page.wait_for_timeout(200)
        log('Pick 3 Confirmed filter = 12', page.locator('#p3-tbody tr').count() == 12)
        page.locator('#panel-pick3 .sf-partial').click(); page.wait_for_timeout(200)
        log('Pick 3 Partial filter = 0 (shows 1 no-results row)', page.locator('#p3-tbody tr').count() == 1)
        page.locator('#panel-pick3 .sf-pending').click(); page.wait_for_timeout(200)
        log('Pick 3 Pending filter = 0 (shows 1 no-results row)', page.locator('#p3-tbody tr').count() == 1)
        page.locator('#panel-pick3 .sf-all').click(); page.wait_for_timeout(200)
        log('Pick 3 All filter = 12', page.locator('#p3-tbody tr').count() == 12)

        print('\n4. PICK 3 — Draw Tabs')
        # Switch to Midday tab (3/15 midday data: 10 rows)
        page.locator('#panel-pick3 .draw-tab').nth(0).click(); page.wait_for_timeout(300)
        log('Pick 3 Midday tab has 10 rows', page.locator('#p3-tbody tr').count() == 10)
        # Switch back to Evening tab
        page.locator('#panel-pick3 .draw-tab').nth(1).click(); page.wait_for_timeout(300)

        print('\n5. PICK 3 — Add Entries')
        page.fill('#p3-state', 'TX'); page.fill('#p3-n1', '3'); page.fill('#p3-n2', '7'); page.fill('#p3-n3', '2')
        page.select_option('#p3-status', 'confirmed')
        page.locator('#panel-pick3 .btn-primary').click(); page.wait_for_timeout(200)
        log('Pick 3 confirmed -> 13', page.locator('#p3-s-draws').text_content().strip() == '13')

        page.fill('#p3-state', 'CT'); page.fill('#p3-n1', '5'); page.fill('#p3-n2', ''); page.fill('#p3-n3', '')
        page.select_option('#p3-status', 'partial')
        page.locator('#panel-pick3 .btn-primary').click(); page.wait_for_timeout(200)
        log('Pick 3 partial -> 1', page.locator('#p3-s-partial').text_content().strip() == '1')

        page.fill('#p3-state', ''); page.fill('#p3-n1', '5'); page.fill('#p3-n2', '5'); page.fill('#p3-n3', '5')
        page.locator('#panel-pick3 .btn-primary').click(); page.wait_for_timeout(200)
        log('Pick 3 error: state required', len(page.locator('#p3-error').text_content().strip()) > 0)

        page.fill('#p3-state', 'AL'); page.fill('#p3-n1', ''); page.fill('#p3-n2', ''); page.fill('#p3-n3', '')
        page.select_option('#p3-status', 'confirmed')
        page.locator('#panel-pick3 .btn-primary').click(); page.wait_for_timeout(200)
        log('Pick 3 error: confirmed needs digits', len(page.locator('#p3-error').text_content().strip()) > 0)

        print('\n6. PICK 3 — Edit & Delete')
        page.once('dialog', lambda d: d.accept('5-6-7'))
        page.locator('#p3-tbody .btn-edit').first.click(); page.wait_for_timeout(800)
        first_row = page.locator('#p3-tbody tr').first.text_content()
        log('Edit entry updates row', any(x in first_row for x in ['5','6','7']), f'row: {first_row[:60]}')

        rows_before = page.locator('#p3-tbody tr').count()
        page.once('dialog', lambda d: d.accept())
        page.locator('#p3-tbody .btn-danger').first.click(); page.wait_for_timeout(500)
        log('Delete removes row', page.locator('#p3-tbody tr').count() == rows_before - 1)

        print('\n7. PICK 4 — Tab Switch & Demo')
        page.locator('[data-game="pick4"]').click(); page.wait_for_timeout(500)
        log('Pick 4 panel active', page.evaluate("document.getElementById('panel-pick4').classList.contains('active')"))
        log('Pick 4 confirmed = 8', page.locator('#p4-s-draws').text_content().strip() == '8')
        log('Pick 4 partial = 0', page.locator('#p4-s-partial').text_content().strip() == '0')
        log('Pick 4 pending = 0', page.locator('#p4-s-pending').text_content().strip() == '0')
        log('Pick 4 midday shows 8 rows', page.locator('#p4-tbody tr').count() == 8)
        # CA is on Evening tab (pending), not Midday
        p4_text = page.locator('#p4-tbody').inner_text()
        log('Pick 4 midday has GA', 'GA' in p4_text, 'GA row missing from midday tab')
        log('Pick 4 hot tile', page.locator('#p4-s-hot').text_content().strip() != '—')
        log('Pick 4 absent tile', page.locator('#p4-s-absent').text_content().strip() != '—')
        log('Pick 4 top pick tile', page.locator('#p4-s-pick').text_content().strip() != '—')

        print('\n8. PICK 4 — Status Filters')
        page.locator('#panel-pick4 .sf-confirmed').click(); page.wait_for_timeout(200)
        log('Pick 4 Confirmed = 8', page.locator('#p4-tbody tr').count() == 8)
        page.locator('#panel-pick4 .sf-partial').click(); page.wait_for_timeout(200)
        log('Pick 4 Partial = 0 (1 no-results row)', page.locator('#p4-tbody tr').count() == 1)
        page.locator('#panel-pick4 .sf-pending').click(); page.wait_for_timeout(200)
        log('Pick 4 Pending = 1', page.locator('#p4-tbody tr').count() == 1)
        page.locator('#panel-pick4 .sf-all').click(); page.wait_for_timeout(200)
        log('Pick 4 All = 8 (midday only)', page.locator('#p4-tbody tr').count() == 8)

        print('\n9. PICK 4 — Add Entry & Analysis')
        page.fill('#p4-state', 'WI'); page.fill('#p4-n1', '1'); page.fill('#p4-n2', '2')
        page.fill('#p4-n3', '3'); page.fill('#p4-n4', '4')
        page.select_option('#p4-status', 'confirmed')
        page.locator('#panel-pick4 .btn-primary').click(); page.wait_for_timeout(200)
        log('Pick 4 confirmed -> 9', page.locator('#p4-s-draws').text_content().strip() == '9')
        log('Pick 4 freq table', page.locator('#p4-freq table').count() > 0)
        log('Pick 4 pos maps', page.locator('#p4-posmaps .pos-map').count() > 0)
        log('Pick 4 Optimizer rendered', page.locator('#p4-picks .opt-panel').count() > 0)
        log('Pick 4 snapshot', page.locator('#p4-snapshot .card-sm').count() > 0)

        print('\n10. PICK 4 — Evening tab (should be empty; CA is merged into midday)')
        page.locator('#panel-pick4 .draw-tab').nth(1).click(); page.wait_for_timeout(300)
        eve_text = page.locator('#p4-tbody').inner_text().lower()
        log('Pick 4 Evening tab shows CA pending', 'CA' in page.locator('#p4-tbody').inner_text(), f'unexpected content: {eve_text[:80]}')
        page.locator('#panel-pick4 .draw-tab').nth(0).click(); page.wait_for_timeout(300)

        print('\n11. PICK 5 — Tab Switch & Demo')
        page.locator('[data-game="pick5"]').click(); page.wait_for_timeout(500)
        log('Pick 5 panel active', page.evaluate("document.getElementById('panel-pick5').classList.contains('active')"))
        log('Pick 5 confirmed = 3', page.locator('#p5-s-draws').text_content().strip() == '3')
        log('Pick 5 partial = 0', page.locator('#p5-s-partial').text_content().strip() == '0')
        log('Pick 5 pending = 0', page.locator('#p5-s-pending').text_content().strip() == '0')
        log('Pick 5 shows 3 rows (midday)', page.locator('#p5-tbody tr').count() == 3)
        log('Pick 5 hot tile', page.locator('#p5-s-hot').text_content().strip() != '—')
        log('Pick 5 top pick', page.locator('#p5-s-pick').text_content().strip() != '—')

        print('\n12. PICK 5 — Status Filters')
        page.locator('#panel-pick5 .sf-confirmed').click(); page.wait_for_timeout(200)
        log('Pick 5 Confirmed = 3', page.locator('#p5-tbody tr').count() == 3)
        page.locator('#panel-pick5 .sf-partial').click(); page.wait_for_timeout(200)
        log('Pick 5 Partial = 0 (shows no-results row)', page.locator('#p5-tbody tr').count() == 1)
        page.locator('#panel-pick5 .sf-pending').click(); page.wait_for_timeout(200)
        log('Pick 5 Pending = 0 (shows no-results row)', page.locator('#p5-tbody tr').count() == 1)
        page.locator('#panel-pick5 .sf-all').click(); page.wait_for_timeout(200)
        log('Pick 5 All = 3 (midday)', page.locator('#p5-tbody tr').count() == 3)

        print('\n13. PICK 5 — Add Entry & Analysis')
        page.fill('#p5-state', 'TX')
        page.fill('#p5-n1', '1'); page.fill('#p5-n2', '2'); page.fill('#p5-n3', '3')
        page.fill('#p5-n4', '4'); page.fill('#p5-n5', '5')
        page.select_option('#p5-status', 'confirmed')
        page.locator('#panel-pick5 .btn-primary').click(); page.wait_for_timeout(200)
        log('Pick 5 confirmed -> 4', page.locator('#p5-s-draws').text_content().strip() == '4')
        log('Pick 5 freq table', page.locator('#p5-freq table').count() > 0)
        log('Pick 5 pos maps', page.locator('#p5-posmaps .pos-map').count() > 0)
        log('Pick 5 Optimizer rendered', page.locator('#p5-picks .opt-panel').count() > 0)
        log('Pick 5 snapshot', page.locator('#p5-snapshot .card-sm').count() > 0)

        print('\n14. PICK 6 — Tab Switch & Demo')
        page.locator('[data-game="pick6"]').click(); page.wait_for_timeout(500)
        log('Pick 6 panel active', page.evaluate("document.getElementById('panel-pick6').classList.contains('active')"))
        log('Pick 6 confirmed = 0', page.locator('#p6-s-draws').text_content().strip() == '0')
        log('Pick 6 partial = 0', page.locator('#p6-s-partial').text_content().strip() == '0')
        log('Pick 6 pending = 5', page.locator('#p6-s-pending').text_content().strip() == '5')
        log('Pick 6 shows 5 rows', page.locator('#p6-tbody tr').count() == 5)

        print('\n15. PICK 6 — Status Filters')
        page.locator('#panel-pick6 .sf-confirmed').click(); page.wait_for_timeout(200)
        log('Pick 6 Confirmed = 0 (shows no-results row)', page.locator('#p6-tbody tr').count() == 1)
        page.locator('#panel-pick6 .sf-partial').click(); page.wait_for_timeout(200)
        log('Pick 6 Partial = 0 (shows no-results row)', page.locator('#p6-tbody tr').count() == 1)
        page.locator('#panel-pick6 .sf-pending').click(); page.wait_for_timeout(200)
        log('Pick 6 Pending = 5', page.locator('#p6-tbody tr').count() == 5)
        page.locator('#panel-pick6 .sf-all').click(); page.wait_for_timeout(200)
        log('Pick 6 All = 5', page.locator('#p6-tbody tr').count() == 5)

        print('\n16. PICK 6 — Add Entry & Analysis')
        page.fill('#p6-state', 'CA')
        page.fill('#p6-n1', '1'); page.fill('#p6-n2', '2'); page.fill('#p6-n3', '3')
        page.fill('#p6-n4', '4'); page.fill('#p6-n5', '5'); page.fill('#p6-n6', '6')
        page.select_option('#p6-status', 'confirmed')
        page.locator('#panel-pick6 .btn-primary').click(); page.wait_for_timeout(200)
        log('Pick 6 confirmed -> 1', page.locator('#p6-s-draws').text_content().strip() == '1')
        log('Pick 6 freq table', page.locator('#p6-freq table').count() > 0)
        log('Pick 6 pos maps', page.locator('#p6-posmaps .pos-map').count() > 0)
        log('Pick 6 Optimizer rendered', page.locator('#p6-picks .opt-panel').count() > 0)
        log('Pick 6 snapshot', page.locator('#p6-snapshot .card-sm').count() > 0)

        print('\n17. Summary Banner Tiles')
        log('Pick 3 banner has 8 tiles', page.locator('#p3-summary .sb-item').count() == 8)
        log('Pick 4 banner has 7 tiles', page.locator('#p4-summary .sb-item').count() == 7)
        log('Pick 5 banner has 7 tiles', page.locator('#p5-summary .sb-item').count() == 7)
        log('Pick 6 banner has 7 tiles', page.locator('#p6-summary .sb-item').count() == 7)

        print('\n18. Cash 3')
        page.locator('[data-game="cash3"]').click(); page.wait_for_timeout(400)
        log('Cash 3 panel active', page.evaluate("document.getElementById('panel-cash3').classList.contains('active')"))
        # Midday tab: GA(confirmed), TN(pending), FL(pending) = 1 confirmed, 2 pending
        c3_draws = page.locator('#c3-s-draws').text_content().strip()
        log('Cash 3 midday confirmed=1', c3_draws == '1', f'got {c3_draws}')
        log('Cash 3 midday rows=3', page.locator('#c3-tbody tr').count() == 3)
        log('Cash 3 freq table', page.locator('#c3-freq table').count() > 0)
        log('Cash 3 Optimizer rendered', page.locator('#c3-picks .opt-panel').count() > 0)
        # Evening tab
        page.locator('#panel-cash3 .draw-tab:nth-child(2)').click(); page.wait_for_timeout(300)
        c3e_draws   = page.locator('#c3-s-draws').text_content().strip()
        c3e_pending = page.locator('#c3-s-pending').text_content().strip()
        log('Cash 3 evening confirmed=0', c3e_draws == '0', f'got {c3e_draws}')
        log('Cash 3 evening pending=3',   c3e_pending == '3', f'got {c3e_pending}')
        # Add new entry (midday) and confirm counter increments
        page.locator('#panel-cash3 .draw-tab:nth-child(1)').click(); page.wait_for_timeout(300)
        page.fill('#c3-state', 'SC'); page.fill('#c3-n1', '3'); page.fill('#c3-n2', '8'); page.fill('#c3-n3', '1')
        page.select_option('#c3-status', 'confirmed')
        page.locator('#panel-cash3 .btn-primary').click(); page.wait_for_timeout(300)
        log('Cash 3 entry added (→ 2 confirmed)', page.locator('#c3-s-draws').text_content().strip() == '2')

        print('\n19. Daily 3')
        page.locator('[data-game="daily3"]').click(); page.wait_for_timeout(400)
        log('Daily 3 panel active', page.evaluate("document.getElementById('panel-daily3').classList.contains('active')"))
        # Midday tab: MI, IN, IL all pending = 0 confirmed, 3 pending
        d3_draws = page.locator('#d3-s-draws').text_content().strip()
        log('Daily 3 midday confirmed=0', d3_draws == '0', f'got {d3_draws}')
        log('Daily 3 midday rows=3', page.locator('#d3-tbody tr').count() == 3)
        # Evening tab
        page.locator('#panel-daily3 .draw-tab:nth-child(2)').click(); page.wait_for_timeout(300)
        d3e_draws = page.locator('#d3-s-draws').text_content().strip()
        log('Daily 3 evening confirmed=0', d3e_draws == '0', f'got {d3e_draws}')
        # Add new entry (midday) and confirm counter increments
        page.locator('#panel-daily3 .draw-tab:nth-child(1)').click(); page.wait_for_timeout(300)
        page.fill('#d3-state', 'OH'); page.fill('#d3-n1', '7'); page.fill('#d3-n2', '1'); page.fill('#d3-n3', '4')
        page.select_option('#d3-status', 'confirmed')
        page.locator('#panel-daily3 .btn-primary').click(); page.wait_for_timeout(300)
        log('Daily 3 entry added (→ 1 confirmed)', page.locator('#d3-s-draws').text_content().strip() == '1')

        print('\n20. Powerball / Mega / Lucky5')
        # ── Powerball ──
        page.locator('[data-game="powerball"]').click(); page.wait_for_timeout(400)
        log('Powerball panel active', page.evaluate("document.getElementById('panel-powerball').classList.contains('active')"))
        pb_draws = page.locator('#pb-s-draws').text_content().strip()
        log('Powerball draws = 6', pb_draws == '6', f'got {pb_draws}')
        pb_balls = page.locator('#pb-scoreboard .big-ball').count()
        log('Powerball balls rendered (36)', pb_balls == 36, f'got {pb_balls}')
        # two-digit PB balls should have ball-2d class
        pb_2d_ok = page.evaluate("""
          Array.from(document.querySelectorAll('#pb-scoreboard .big-ball'))
            .filter(b => parseInt(b.textContent) >= 10)
            .every(b => b.classList.contains('ball-2d'))
        """)
        log('Powerball two-digit balls have ball-2d', pb_2d_ok)
        # single-digit PB balls should NOT have ball-2d class
        pb_1d_ok = page.evaluate("""
          Array.from(document.querySelectorAll('#pb-scoreboard .big-ball'))
            .filter(b => parseInt(b.textContent) < 10)
            .every(b => !b.classList.contains('ball-2d'))
        """)
        log('Powerball single-digit balls no ball-2d', pb_1d_ok)
        # Powerball frequency table present
        log('Powerball freq table present', page.locator('#pb-freq .ball').count() > 0)
        # ── Mega Millions ──
        page.locator('[data-game="megamillions"]').click(); page.wait_for_timeout(400)
        log('Mega Millions panel active', page.evaluate("document.getElementById('panel-megamillions').classList.contains('active')"))
        mm_draws = page.locator('#mm-s-draws').text_content().strip()
        log('Mega Millions draws = 4', mm_draws == '4', f'got {mm_draws}')
        mm_balls = page.locator('#mm-scoreboard .big-ball').count()
        log('Mega Millions balls rendered (24)', mm_balls == 24, f'got {mm_balls}')
        mm_2d_ok = page.evaluate("""
          Array.from(document.querySelectorAll('#mm-scoreboard .big-ball'))
            .filter(b => parseInt(b.textContent) >= 10)
            .every(b => b.classList.contains('ball-2d'))
        """)
        log('Mega Millions two-digit balls have ball-2d', mm_2d_ok)
        log('Mega Millions freq table present', page.locator('#mm-freq .ball').count() > 0)
        # ── 5+Bonus panel (lucky5) ──
        page.locator('[data-game="lucky5"]').click(); page.wait_for_timeout(400)
        log('5+Bonus panel active', page.evaluate("document.getElementById('panel-lucky5').classList.contains('active')"))
        tab_txt = page.locator('[data-game="lucky5"]').text_content()
        log('5+Bonus tab label', '5+Bonus' in tab_txt or 'Bonus' in tab_txt)
        # 6 preloaded draws (CA SuperLotto)
        l5_draws = page.locator('#l5-s-draws').text_content().strip()
        log('5+Bonus draws = 6', l5_draws == '6', f'got {l5_draws}')
        # 6 draws × 6 balls (5 main + 1 bonus) = 36
        l5_balls = page.locator('#l5-scoreboard .big-ball').count()
        log('5+Bonus balls rendered (36)', l5_balls == 36, f'got {l5_balls}')
        # bonus balls use slmega class
        l5_mega_count = page.evaluate("document.querySelectorAll('#l5-scoreboard .slmega').length")
        log('5+Bonus bonus balls = 6', l5_mega_count == 6, f'got {l5_mega_count}')
        # two-digit main balls have ball-2d
        l5_2d_ok = page.evaluate("""
          Array.from(document.querySelectorAll('#l5-scoreboard .wb'))
            .filter(b => parseInt(b.textContent) >= 10)
            .every(b => b.classList.contains('ball-2d'))
        """)
        log('5+Bonus two-digit balls have ball-2d', l5_2d_ok)
        # Ball freq map = 50 buckets, Bonus freq map = 27 buckets
        log('5+Bonus ball freq map (50 balls)', page.locator('#l5-freq .ball').count() == 50)
        log('5+Bonus bonus freq map (27 balls)', page.locator('#l5-megafreq .ball').count() == 27)
        # input max attributes
        log('Ball input max=50', page.get_attribute('#l5-n1','max') == '50')
        log('Bonus input max=27', page.get_attribute('#l5-mega','max') == '27')
        # state column visible in scoreboard
        l5_has_state = page.evaluate("document.querySelectorAll('#l5-scoreboard').length > 0")
        log('5+Bonus scoreboard rendered', l5_has_state)
        # live clock tile visible in summary
        l5_clock = page.locator('#l5-s-clock').text_content().strip()
        log('5+Bonus live clock tile populated', len(l5_clock) > 4)

        print('\n21. Data Persistence After Tab Switches')
        page.locator('[data-game="pick3"]').click(); page.wait_for_timeout(500)

        # ── NEW: Auto-Calibrate button + Optimizer results ──
        print('\n21a. Auto-Calibrate Button & Next Draw Predictions')
        page.locator('[data-game="pick3"]').click(); page.wait_for_timeout(400)
        # Switch to Evening (has confirmed data)
        page.locator('#panel-pick3 .draw-tab:nth-child(2)').click(); page.wait_for_timeout(300)
        # Verify Auto-Calibrate button exists
        calib_btn = page.locator('#p3-picks #p3-btn-calibrate').count()
        log('Pick 3 Auto-Calibrate button present', calib_btn > 0)
        # Verify OPTIMIZE button still present
        opt_btn = page.locator('#p3-picks .btn-optimize').count()
        log('Pick 3 OPTIMIZE button present', opt_btn > 0)
        # Click OPTIMIZE (faster than calibrate for testing)
        page.locator('#p3-picks .btn-optimize').click()
        page.wait_for_timeout(8000)  # wait for 5000 iterations to complete
        # Verify results rendered
        opt_results = page.locator('#p3-opt-results').inner_html()
        log('Pick 3 Optimizer results rendered', len(opt_results) > 50)
        # Verify next-draw panel rendered
        next_panel_html = page.locator('#p3-next-draw-panel').inner_html()
        log('Pick 3 Next Draw panel rendered', len(next_panel_html) > 50)
        log('Pick 3 Next Draw panel has date', '2026' in next_panel_html or '/' in next_panel_html)
        log('Pick 3 Next Draw panel has time zones', 'ET' in next_panel_html)
        log('Pick 3 Next Draw panel has predictions', 'ball' in next_panel_html)

        print('\n21b. Timezone Correctness (America/New_York)')
        # Verify getETDateParts and todayET use America/New_York (not manual DST)
        tz_check = page.evaluate('''() => {
            // Check that getETDateParts exists and uses Intl
            if (typeof getETDateParts !== 'function') return { ok: false, reason: 'getETDateParts not defined' };
            const p = getETDateParts();
            // Should have all expected fields
            const hasFields = ['year','month','day','hour','minute','second','dayOfWeek']
                .every(k => k in p);
            if (!hasFields) return { ok: false, reason: 'missing fields: ' + JSON.stringify(p) };
            // year should be 2026
            if (p.year !== 2026) return { ok: false, reason: 'year=' + p.year };
            // month should be 1-12
            if (p.month < 1 || p.month > 12) return { ok: false, reason: 'month=' + p.month };
            // hour should be 0-23
            if (p.hour < 0 || p.hour > 23) return { ok: false, reason: 'hour=' + p.hour };
            return { ok: true, parts: p };
        }''')
        log('getETDateParts() returns valid ET parts', tz_check.get('ok', False),
            tz_check.get('reason', str(tz_check.get('parts', ''))))

        # Verify todayET uses getETDateParts (no manual DST code)
        today_check = page.evaluate('''() => {
            if (typeof todayET !== 'function') return { ok: false, reason: 'todayET not defined' };
            const t = todayET();
            // Should be M/D/YYYY or MM/DD/YYYY format
            if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return { ok: false, reason: 'format=' + t };
            // Year should be 2026
            const yr = t.split('/')[2];
            if (yr !== '2026') return { ok: false, reason: 'year=' + yr };
            return { ok: true, date: t };
        }''')
        log('todayET() returns M/D/YYYY in ET (America/New_York)', today_check.get('ok', False),
            today_check.get('reason', 'date=' + str(today_check.get('date', ''))))

        # Verify getNextDrawDate returns correct structure
        next_draw_check = page.evaluate('''() => {
            if (typeof getNextDrawDate !== 'function') return { ok: false, reason: 'getNextDrawDate not defined' };
            const r = getNextDrawDate('pick3', 'evening');
            if (!r || r.dateStr === 'TBD') return { ok: false, reason: 'dateStr=TBD' };
            // dateStr should be M/D/YYYY
            if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(r.dateStr)) return { ok: false, reason: 'dateStr format=' + r.dateStr };
            // timeEt should end with ET
            if (!r.timeEt || !r.timeEt.endsWith('ET')) return { ok: false, reason: 'timeEt=' + r.timeEt };
            // timesCt should end with CT
            if (!r.timesCt || !r.timesCt.endsWith('CT')) return { ok: false, reason: 'timesCt=' + r.timesCt };
            // timesMt should end with MT
            if (!r.timesMt || !r.timesMt.endsWith('MT')) return { ok: false, reason: 'timesMt=' + r.timesMt };
            // timesPt should end with PT
            if (!r.timesPt || !r.timesPt.endsWith('PT')) return { ok: false, reason: 'timesPt=' + r.timesPt };
            return { ok: true, dateStr: r.dateStr, timeEt: r.timeEt };
        }''')
        log('getNextDrawDate() returns ET date + all 4 US zones', next_draw_check.get('ok', False),
            next_draw_check.get('reason', next_draw_check.get('dateStr','') + ' ' + next_draw_check.get('timeEt','')))

        # Verify no manual DST code (isDST / etOffset) in the rendered page
        no_dst_check = page.evaluate('''() => {
            // Check that manual DST variables are not defined globally
            const hasDST = typeof isDST !== "undefined";
            const hasEtOffset = typeof etOffset !== "undefined";
            const hasDstStart = typeof dstStart !== "undefined";
            return { ok: !hasDST && !hasEtOffset && !hasDstStart,
                     isDST: hasDST, etOffset: hasEtOffset, dstStart: hasDstStart };
        }''')
        log('No manual DST globals (isDST/etOffset/dstStart removed)', no_dst_check.get('ok', False),
            str(no_dst_check) if not no_dst_check.get('ok') else '')

        # Verify clock shows ET
        clock_text = page.locator('#clock').text_content()
        log('Header clock shows ET', 'ET' in clock_text, f'clock="{clock_text}"')

        # Verify pick6 next draw is Mon/Wed/Sat
        pick6_day_check = page.evaluate('''() => {
            if (typeof getNextDrawDate !== 'function') return { ok: false };
            const r = getNextDrawDate('pick6', 'evening');
            if (!r || r.dateStr === 'TBD') return { ok: false, reason: 'TBD' };
            // Parse dateStr M/D/YYYY → Date
            const [mo, dy, yr] = r.dateStr.split('/').map(Number);
            // get day-of-week in ET for that date (use noon UTC)
            const d = new Date(Date.UTC(yr, mo-1, dy, 12, 0, 0));
            const p = getETDateParts(d);
            const validDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
            const pick6Days = ['Mon','Wed','Sat'];
            return { ok: pick6Days.includes(p.dayOfWeek),
                     dateStr: r.dateStr, dayOfWeek: p.dayOfWeek };
        }''')
        log('Pick 6 next draw lands on Mon/Wed/Sat', pick6_day_check.get('ok', False),
            f"date={pick6_day_check.get('dateStr','')} dow={pick6_day_check.get('dayOfWeek','')}")

        # Verify relative timezone offsets are correct (CT=ET-1, MT=ET-2, PT=ET-3)
        offset_check = page.evaluate('''() => {
            if (typeof getNextDrawDate !== "function") return { ok: false };
            const r = getNextDrawDate("pick3", "evening");
            // parse ET hour from timeEt like "7:57 PM ET"
            const parseH = (s) => {
                const m = s.match(/(\\d+):(\\d+)\\s*(AM|PM)/i);
                if (!m) return -1;
                let h = parseInt(m[1]);
                if (m[3].toUpperCase()==="PM" && h!==12) h+=12;
                if (m[3].toUpperCase()==="AM" && h===12) h=0;
                return h;
            };
            const hEt = parseH(r.timeEt);
            const hCt = parseH(r.timesCt);
            const hMt = parseH(r.timesMt);
            const hPt = parseH(r.timesPt);
            // CT should be ET-1, MT should be ET-2, PT should be ET-3
            const ctOk = ((hEt - hCt + 24) % 24) === 1;
            const mtOk = ((hEt - hMt + 24) % 24) === 2;
            const ptOk = ((hEt - hPt + 24) % 24) === 3;
            return { ok: ctOk && mtOk && ptOk,
                     et: r.timeEt, ct: r.timesCt, mt: r.timesMt, pt: r.timesPt,
                     ctOk, mtOk, ptOk };
        }''')
        log('US timezone offsets ET→CT(-1h)→MT(-2h)→PT(-3h) correct',
            offset_check.get('ok', False),
            f"ET:{offset_check.get('et','')} CT:{offset_check.get('ct','')} MT:{offset_check.get('mt','')} PT:{offset_check.get('pt','')}")

        p3_rows = page.locator('#p3-tbody tr').count()
        log('Pick 3 data preserved', p3_rows >= 10, f'got {p3_rows}')
        page.locator('[data-game="pick4"]').click(); page.wait_for_timeout(300)
        p4_draws = page.locator('#p4-s-draws').text_content().strip()
        log('Pick 4 data preserved (9 confirmed)', p4_draws == '9', f'got {p4_draws}')

        print('\n22. Clear All')
        page.locator('[data-game="pick3"]').click(); page.wait_for_timeout(300)
        page.once('dialog', lambda d: d.accept())
        # Use the specific "Clear All" button by text
        page.get_by_role('button', name='\xd7 Clear').click(); page.wait_for_timeout(500)
        log('Clear All resets Pick 3 confirmed', page.locator('#p3-s-draws').text_content().strip() == '0')
        log('Clear All shows empty table', page.locator('#p3-tbody tr').count() == 1)
        page.locator('[data-game="pick4"]').click(); page.wait_for_timeout(300)
        log('Clear All resets Pick 4 too', page.locator('#p4-s-draws').text_content().strip() == '0')

        print('\n23. Refresh All')
        page.locator('.btn-update').click(); page.wait_for_timeout(1500)
        btn = page.locator('.btn-update').text_content().strip()
        log('Refresh All button restores text', 'Update' in btn, f'got "{btn}"')

        print('\n═══════════════════════════════════════')
        print(f'RESULTS: {passed} passed, {failed} failed')
        if issues:
            print('\nFAILED TESTS:')
            for i in issues:
                print(f"  ❌ {i['name']}: {i['detail']}")
        
        browser.close()
        return failed

run_tests()
sys.exit(1 if failed > 0 else 0)
