// @ts-nocheck
import { useState } from 'react'

// The built-in user guide: how every part of the app works, in plain language.
// Lives in Settings. Static text by design — update it when features change.
const SECTIONS = [
  {
    title: 'The big number: Safe to spend',
    body: (
      <>
        <p>
          This is the one number to trust: what you can actually spend without
          hurting yourself. It starts from your real bank balance and subtracts
          everything that's already spoken for:
        </p>
        <ul>
          <li>
            <strong>Bills due before your next paycheck</strong> — including bills due
            today, or still unpaid from a due date that's already passed, that you
            haven't paid yet. When a payment shows up in your bank feed, the app
            matches it to the bill and releases that money automatically.
          </li>
          <li>
            <strong>A loan or bill that hasn't started yet</strong> — if it has a
            <strong> first payment date</strong> still in the future, the app holds
            that payment now (so you save for it) but does <strong>not</strong> mark
            it late. You'll see <strong>Starts …</strong> and
            <strong> First payment … — save $X</strong>, not Past due.
          </li>
          <li>
            <strong>Everyday spending you've budgeted</strong> — what's still left in
            this pay period's category budgets (groceries, gas, dining, etc.),
            reset from your last real payday. It's shown as one <em>"Everyday
            spending (budgets left)"</em> line, separate from bills — tap it to see
            each category. This makes Safe to spend
            <strong> what's truly free for extras</strong>, after the everyday
            spending you already plan on. As you actually buy groceries, that line
            shrinks by the same amount, so nothing is counted twice — and anything
            in a category you <em>haven't</em> budgeted just spends normally. Set your
            budgets on the <strong>Insights</strong> page. (This is a different
            window than Insights' <em>"This month vs budget"</em>, which tracks the
            same budgets by calendar month instead — the two numbers answering
            "how's my grocery budget" won't always match, and that's expected.)
          </li>
          <li>
            <strong>Your buffer floor</strong> — the untouchable reserve you set in
            Settings.
          </li>
          <li>
            <strong>Already saved in goals</strong> — including trips (a trip
            is just a goal with a deadline).
          </li>
        </ul>
        <p>
          The slim strip at the top of the dashboard shows the four vitals at a
          glance — Safe to spend, Total cash, Spent this month, and your
          debt-free date. A small Safe-to-spend also stays visible in the menu
          bar wherever you are in the app.
        </p>
        <p>
          Under the number you'll see a per-day amount ("≈ $X/day until your next
          paycheck") — spend under that and you'll make it to payday without
          touching reserves. Tap <em>"Can I afford something?"</em> to test a
          purchase before you make it — it shows what you'd have left today, and,
          just as important, what your <strong>lowest point before payday</strong>
          would drop to. A buy today drags that low down too, so if it would push
          your lowest day into your buffer, you'll get a heads-up even when today's
          number still looks fine.
        </p>
        <p>
          If the number is ever negative, it means your upcoming bills exceed what's
          in the bank — the app is warning you early, not judging you.
        </p>
      </>
    ),
  },
  {
    title: 'Daily rhythm: how to use the app',
    body: (
      <>
        <ul>
          <li>
            <strong>Brand new?</strong> A <strong>"Let's get you set up"</strong>
            card sits at the top of the Dashboard until three things exist: an
            account, your paycheck, and your regular bills. Safe to spend can't
            mean anything until all three are in, so the card walks you through
            them in order and disappears on its own once you're done.
          </li>
          <li>
            <strong>Just open it.</strong> Your bank balances and transactions sync
            automatically every time the app opens. The ↻ icon on the Accounts tile
            forces a fresh pull.
          </li>
          <li>
            <strong>Glance at Safe to spend</strong> before spending money. That's
            the whole habit.
          </li>
          <li>
            On a computer the menu runs down the <strong>left side</strong>; on
            the phone it's the <strong>bar along the bottom</strong>. All six
            pages either way.
          </li>
          <li>
            <strong>Check-in</strong> (in the menu) walks you through confirming your
            balances every few days. Bank-linked accounts already show today's
            synced balance — you confirm them instead of retyping. Cash and
            anything the bank does not see is still typed by hand. The forecast
            stays honest between check-ins by assuming normal everyday spending
            — and assuming every bill that came due in that gap was paid on
            schedule. If one genuinely wasn't, you'll see
            <em>"Still holding — no payment matched yet"</em> on the bill with
            an <strong>I paid this</strong> button.
          </li>
          <li>
            <strong>Cash spending or cash income</strong> (things your bank never
            sees) — add either with the + button; it has a Money out / Money in
            toggle. Every entry must say <strong>which account</strong> it came from
            (or went into), so nothing is ever untracked. Pick a cash/manual account
            and its balance drops (or rises for money in) automatically; pick a bank
            account and it's just recorded — your bank already tracks that balance
            itself. If you later <strong>delete</strong> a cash purchase, it asks
            first and puts the money back; if you <strong>change its amount</strong>,
            the cash balance re-adjusts. So balances always stay honest.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Accounts',
    body: (
      <>
        <p>
          The Accounts tile lists every connected account with its latest balance
          and shows total spendable, total cash, total debt, and net worth.
        </p>
        <ul>
          <li>
            <strong>Tap any row to act on it</strong> — accounts, income, bills,
            goals, planned items, and debts open their editor; recent-spending
            rows open the Transactions page. Quick edits show a green "✓ saved"
            when they stick.
          </li>
          <li>
            <strong>Manage</strong> — edit an account's name, type its current
            balance by hand, hide it, or untick "include in spendable" to leave it
            out of your spending money (a checking you're not spending from, savings,
            etc.). That only changes whether it's counted — the account stays
            whatever type it is — and it shows a faint "not spendable" note.
          </li>
          <li>
            <strong>Hiding an account removes it everywhere</strong> — the list,
            all totals, safe-to-spend, and the forecast. Unhide it anytime in
            Manage.
          </li>
          <li>
            <strong>Reorder accounts</strong> — Settings → Account order, drag them
            into the order you want them listed everywhere.
          </li>
          <li>
            <strong>Cash in your wallet</strong> — tap "+ Track cash on hand" in
            Manage once. It becomes an account so physical cash counts in your
            balances. After that, when you log a cash purchase with the + button
            and pick it under <strong>"Paid with,"</strong> this balance updates
            itself — so you rarely have to edit it by hand again.
          </li>
          <li>
            <strong>Goal buckets</strong> — a savings account that holds money for
            goals shows each goal's slice underneath it plus what's "unassigned," so
            one account can serve several goals. Assign a goal to an account in the
            goal's editor ("Held in").
          </li>
          <li>
            <strong>Transfer status — Pending, Failed, Confirmed.</strong> When you
            label money into a bucket but the bank hasn't synced it yet (Capital One
            can take a few days), the account shows a <strong>🟡 Pending</strong> tag
            for that amount — it knows the money's on the way. Once the bank confirms
            the new balance, the tag clears (<strong>Confirmed</strong>). If a
            transfer you logged still hasn't shown up after about a week, it turns
            <strong> 🔴 Failed</strong> — a nudge to check the transfer actually went
            through. If a goal's "Saved so far" is simply set higher than the bank
            shows and there was no transfer to match it, you'll see a plain
            <strong> 🟡 Over-assigned</strong> note instead — that's just a heads-up
            that the saved amount is more than the account holds, not a transfer.
          </li>
          <li>
            The balance shown is what's <strong>usable right now</strong> — money in
            the bank minus charges that haven't cleared. When that differs from the
            bank's own headline number, the account shows "in bank $X · pending $Y"
            underneath, so the two always reconcile.
          </li>
          <li>
            Bank-connected accounts update themselves; manual edits get overridden
            by the bank's next sync. Capital One's feed updates slower than SoFi's —
            that's Capital One, not the app.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Income',
    body: (
      <>
        <ul>
          <li>
            <strong>Manage</strong> — your income sources (paychecks, gigs). A
            steady paycheck is "confirmed" and counts in forecasts. Anything marked
            <em> side income</em> counts as $0 until it actually lands — the app
            never spends hoped-for money.
          </li>
          <li>
            <strong>Log received</strong> — when money lands, split it by
            percentages across goals, debt paydown, and taxes. Your split rules are
            remembered.
          </li>
          <li>
            <strong>Tagging deposits</strong> — on the Transactions page, any money
            that came in can be tagged with the source it came from (your sources
            appear automatically). The Income tile then shows "Received this month"
            per source.
          </li>
          <li>
            <strong>Tag once, tagged forever</strong> — when you tag a deposit, every
            other untagged deposit from that same depositor gets the same tag, past
            and future (your paycheck tags itself after the first time). A tag you
            set by hand is never overwritten — and if you ever change a depositor's
            tag, your newest choice is what sticks going forward.
          </li>
          <li>
            <strong>Name-only sources</strong> — in Manage, "Add a source name" creates
            a tag with no amount or schedule (e.g. Mountain Dweller, CCP). It never
            touches your forecast.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Bills',
    body: (
      <>
        <ul>
          <li>
            Bills are recurring by schedule (monthly on a day, weekly, etc.). They
            reduce Safe to spend from the moment they're due until the payment
            actually posts in your bank feed.
          </li>
          <li>
            <strong>Edit bills right where you see them.</strong> Tap
            <strong> Manage</strong> on the Dashboard's "Next 30 days of bills"
            tile and every bill you track opens up — change an amount right in the
            row (tap the box, tap away to save), tap <strong>Edit</strong> to change
            the name or schedule, or <strong>Delete</strong>. Tap
            <strong> + Add</strong> to enter a new one (name, amount, how often, and
            the day). Optional: a <strong>first due date</strong> if it doesn't start
            until later — until then it's held as save-for, not overdue. The same
            list is also on Insights → "Recurring bills" if you're already over
            there.
          </li>
          <li>
            The app also <strong>spots recurring charges</strong> you haven't added
            (like a subscription). In that same bills list, under
            <strong> "Spotted — not tracked yet,"</strong> tap <strong>"Add as
            bill"</strong> to confirm a real one or <strong>✕</strong> to dismiss one
            that isn't a bill (an occasional coffee, say). A dismissed one stays gone,
            and it never touched your Safe to spend to begin with — only bills you
            actually track do.
          </li>
          <li>
            <strong>Save for a big one each paycheck.</strong> A large bill (rent) or
            debt payment can blindside you when the whole amount is due at once. Flip
            <strong> "Save each paycheck"</strong> on it — the bill's toggle is in the
            Recurring bills hub, a debt's is right under it on the Debt tile — and the
            app <strong>builds up the money a bit at a time</strong>, holding a little
            more out of your Safe to spend each paycheck until the <strong>whole
            amount is set aside by the day it's due</strong>. So it never surprises
            you, and it can't quietly hit as a lump either (counted once, never
            twice). <strong>Nothing is held the moment you turn it on</strong> — it
            waits for your <strong>next real paycheck</strong> to land, then builds a
            slice at a time from there, so it's never dipping into money you already
            had for something else. Leave it off for the small stuff. (Goals already
            do this — that's their Active toggle.)
          </li>
          <li>
            <strong>Move it to savings — without your number dropping twice.</strong>
            Open the <strong>"Toward bills each paycheck"</strong> or
            <strong> "Toward debt each paycheck"</strong> line on your Safe to spend
            card to see each one: how much is set aside so far, and its target. When
            you actually move that paycheck's share into your savings account, tap
            <strong> "I moved it"</strong>. The app moves the cash out of checking and
            into savings for you and <strong>releases the same amount from the hold</strong>,
            so your Safe to spend doesn't budge — the money was already spoken for.
            The release only counts money that's really in savings, so a transfer your
            bank hasn't shown yet can never make your number look bigger than it is.
            (Tapped it by mistake? Hit <strong>"undo"</strong> right below.)
          </li>
          <li>
            <strong>Three matching lines, one per kind.</strong> Under Safe to spend
            you'll see <strong>"Saving toward goals,"</strong>
            <strong> "Toward debt each paycheck,"</strong> and
            <strong> "Toward bills each paycheck"</strong> — each has a
            <strong> ▸</strong> you can tap to see exactly which goals, debts, or
            bills add up to it. Debt and bills show what's held out right now;
            goals show what's coming with your <strong>next paycheck</strong> (so a
            brand-new goal shows up before it's actually holding anything). A debt
            payment always shows under
            <strong> Debt</strong>, never lumped in with bills. The <strong>● Goals</strong>
            and <strong>● Debt</strong> chips still flip whether each is subtracted at
            all — a quick on/off — and the Debt chip covers <em>all</em> your debt,
            including anything on "Save each paycheck," so it's always there even when
            every debt is smoothed.
          </li>
          <li>
            The Dashboard's <strong>"Next 30 days of bills"</strong> tile is a
            heads-up of what's due in the next 30 days, including your
            <strong> arranged debt payments</strong> (not goals; and not anything
            you're already saving for each paycheck). Its <strong>Manage</strong>
            button edits the bills themselves — debt payments are changed on the
            Debt tile instead.
          </li>
          <li>
            Deleting a bill removes it entirely — this month and all future months,
            with no undo prompt.
          </li>
          <li>
            A debt with a payment + due date automatically shows up in your next-30-days
            bills and your forecast, so scheduled debt payments are counted like any
            other obligation. If the first payment is still ahead, it shows a
            <strong> Starts</strong> badge instead of overdue.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Goals',
    body: (
      <>
        <ul>
          <li>
            A goal is anything you're saving toward — an emergency fund, a purchase,
            a one-time payment. It has a name, a target amount, and an optional
            deadline.
          </li>
          <li>
            <strong>A goal is only being saved for if it has a deadline.</strong>
            Add a <strong>deadline</strong> and the goal gets a plan: it shows what
            to save <strong>per paycheck</strong> to hit it, and that's worked into
            your forecast. Leave the deadline off and it's tagged
            <strong> "no deadline"</strong> — no paycheck plan, sits out of the
            forecast — but you can still put money in anytime and that money counts
            (held out of Safe to spend, and in your net worth). Add a date whenever
            you want it to become a plan.
          </li>
          <li>
            <strong>Saving vs. Paused — tap the pill under a goal.</strong> A goal
            with a deadline starts <strong>● Saving</strong>: it shows what to set aside
            <strong> per paycheck</strong>, and that money is held out of your
            <strong> Safe to spend</strong> and your forecast — so goal money isn't
            money you can also spend. <strong>Nothing is held the moment you create
            or activate a goal</strong> — it waits for your <strong>next real
            paycheck</strong> to land, then builds up a slice at a time from there
            until the full amount's set aside by your date. So money you already
            had for something else is never suddenly grabbed for a new goal. The
            <strong> "Saving toward goals"</strong> line shows what every saving
            goal will be holding once your <strong>next paycheck</strong>
            lands — including a brand-new goal that hasn't started yet — so you
            always know what's coming, not just what's held this second. Tap the
            pill to <strong>○ Pause</strong> a goal: the per-paycheck number
            disappears and nothing is held — the goal just sits there as a target
            you can still see and fund whenever. Use this when you want to
            remember a goal but can't afford its payments yet. If your saving
            goals need more than a paycheck covers, Safe to spend goes negative on
            purpose — a signal to stretch a deadline or pause a goal.
          </li>
          <li>
            <strong>Saved</strong> (the green bar) is money you've put aside — held
            out of Safe to spend so you can't accidentally spend it.
            <strong> Spent</strong> (the brick-red bar) fills as you tag purchases to
            the goal (do that when adding/editing a transaction — "Counts toward
            goal").
          </li>
          <li>
            <strong>Tap any goal to open its editor</strong> — name, target,
            deadline, saved so far, <strong>+ Link a payment</strong> to connect a
            real transaction, <strong>Mark done</strong>, and Delete. You never type
            in a payment amount: put in the <strong>target and a deadline</strong>
            and it tells you what to set aside per paycheck. (Everything here is
            money you're saving toward — there's no "one-time payment" to track.)
          </li>
          <li>
            <strong>Keep several goals in one savings account (buckets).</strong> In
            a goal's editor, set <strong>"Held in"</strong> to a savings account — so
            you don't need a separate account per goal. That account then shows each
            goal's slice plus what's "unassigned." When money lands there, use the +
            button's <strong>"Fill a goal's bucket?"</strong> to add it to the right
            goal. (Money in a savings bucket is counted once, correctly — it's not
            held out of Safe to spend twice.)
          </li>
          <li>
            <strong>A running total sits at the top of the tile</strong> — what to
            set aside per paycheck across all your active goals. If it's bigger than
            a paycheck, your deadlines are tighter than your income and need
            stretching out.
          </li>
          <li>
            <strong>Debt payment plans live under their debt now</strong>, not here —
            look on the Debt tile for InDebted-style installment plans (see the Debt
            section).
          </li>
          <li>Finished goals drop into a collapsed "Completed" list after a week.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Money set aside',
    body: (
      <>
        <p>
          For cash you <strong>already have</strong> but need to keep for a known
          expense coming up — a vet visit, a registration, a bill you got money for
          early. It's not a savings goal (you're not saving up) and not a debt —
          just a hold.
        </p>
        <ul>
          <li>
            On the <strong>"Held for known expenses"</strong> tile, tap
            <strong> "+ Hold money for something,"</strong> enter the amount and what it's for
            (a date is optional), and tap <strong>Hold it</strong>.
          </li>
          <li>
            That amount drops straight out of your <strong>Safe to spend</strong>
            (you'll see a "Set aside" line in the breakdown) and out of your lowest-day
            forecast — so you can't accidentally spend it.
          </li>
          <li>
            When you've paid it, or you no longer need to hold it, tap
            <strong> Done</strong> and the money flows back into safe to spend.
          </li>
          <li>
            Use this instead of making a fake savings goal for a one-time expense.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Debt',
    body: (
      <>
        <ul>
          <li>
            <strong>Pick the debt's type</strong> when you add or edit it — credit
            card, loan, buy-now-pay-later, medical, collections, personal, or other.
            It shows under the debt's name so each one reads like what it really is.
          </li>
          <li>
            <strong>Set what you pay, how often, and the next date.</strong> Every
            field in the editor is labeled now. Enter <strong>what you pay each
            time</strong>, choose <strong>how often</strong> (monthly, every 2 weeks,
            or weekly), and the <strong>next payment date</strong> — the app schedules
            it correctly in your forecast (a $75 payment every 2 weeks is counted as
            $75 every two weeks, not $75 a month). Each debt's tile shows its
            <strong> next payment date</strong> so you can see what's coming up.
          </li>
          <li>
            <strong>First payment date — if it isn't due yet.</strong> On add or edit,
            set <strong>First payment</strong> to the first day this debt is actually
            collectible (example: a loan that starts Oct 1). Until that date, Safe to
            spend <strong>holds the payment</strong> and the tile says
            <strong> "First payment … — save $X"</strong> with a
            <strong> Starts</strong> badge. It is <strong>not late</strong>. On that
            date it becomes a normal due-the-Nth payment. Leave First payment blank
            if you're already in the cycle. Don't make a separate goal or set-aside
            for the same first payment — that would hold the money twice.
          </li>
          <li>
            <strong>Been paying it a while? Add it with a start date.</strong> When
            you add a debt, fill in the <strong>original amount</strong> and a
            <strong> "Started on"</strong> date in the past — that's when the loan
            began, used only to work today's balance forward (original amount minus
            every payment due since then) and project the payoff. Different from
            <strong> First payment</strong> above. You can still type the balance
            yourself to override it. Leave "Started on" blank for a brand-new debt.
          </li>
          <li>
            <strong>Every debt has a progress bar.</strong> Credit cards show
            <strong> how much of your limit is used</strong> (balance vs. credit
            limit — add the limit via Manage → Edit; the bar turns amber when it's
            high). Every other type shows <strong>how far you've paid it down</strong>
            toward the original or settlement amount. Each debt also shows its
            interest cost and a projected payoff date at your current payment.
          </li>
          <li>
            <strong>Pause a debt — tap ● Active / ○ Inactive.</strong> Every debt has
            a small pill under it. Tap it to make the debt <strong>○ Inactive</strong>
            and it drops out of your bills, your forecast, your Safe to spend, and
            your payoff plan — but stays <strong>listed (greyed out)</strong> so you
            never lose track of it. Handy for a debt you're disputing or have put on
            hold. Tap again to bring it back to <strong>● Active</strong>. (Same idea
            as pausing a goal.) One exception: your <strong>Total
            owed and net worth</strong> still count an Inactive debt — pausing it
            only pauses the planning, not the fact that you still owe it.
          </li>
          <li>
            <strong>Payment plans show under their debt.</strong> If a debt has an
            installment plan (like InDebted's), you'll see
            <strong> "Next payment $X · date · N of M paid"</strong> right under it.
            Tap that to edit the whole plan — you enter the <strong>total owed and
            how many payments</strong>, and it works out each payment for you (plus
            how often and the first date). Put the first date in the past and it
            counts what you've already paid.
          </li>
          <li>
            <strong>Log a payment — including one you already made.</strong> Use the
            <strong> "Log payment"</strong> button at the top of the Debt tile, or the
            <strong> "+ Log a payment"</strong> link under any debt. Enter the amount
            and the <strong>date you paid</strong> — today or a past date. Each one
            lowers the balance and shows in a <strong>dated list under the debt</strong>,
            so you can see every payment you've made. Tap the <strong>×</strong> next to
            a payment to undo it (the balance goes back up). The bar and payoff date
            update instantly. (Bank-linked debts keep the synced balance — the payment
            is still logged, the bank updates the balance itself.)
          </li>
          <li>
            The green line at the bottom is your <strong>debt-free date</strong> at
            current payments — but it assumes you actively redirect each
            debt's payment to the next one in line once it's paid off. The app
            doesn't do that for you automatically; you have to raise the next
            payment yourself each time one clears. The Insights page has the
            full payoff planner (avalanche vs snowball, extra-payment slider).
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Credit tab',
    body: (
      <>
        <ul>
          <li>
            <strong>Log scores</strong> — record your credit scores as you get them
            (from your bank or a free service). The page keeps the latest per
            bureau and charts your progress over time.
          </li>
          <li>
            <strong>Card utilization</strong> — how much of your credit limits
            you're using. Keep it under 30% (the marked line); lower helps your
            score. Add each card's limit to see it.
          </li>
          <li>
            <strong>Collections</strong> — tracked separately with their settlement
            status, so you can watch them clear.
          </li>
          <li>
            <strong>Action plan</strong> — a checklist of score-building steps,
            organized by phase. Check them off as you go.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Forecast & cash-flow calendar',
    body: (
      <>
        <ul>
          <li>
            The forecast box walks your balance day by day through upcoming
            bills, paychecks, planned items, and normal everyday spending. It
            shows your <strong>lowest day</strong> — the tightest moment before
            money comes back in — for the window you pick (next paycheck / 2
            weeks / 30 days). Its header and color change with what it finds:
            <strong> "On track"</strong> (green) if you stay clear, <strong>
            "Dips into your reserve"</strong> (amber) if you go under your
            buffer without going negative, or <strong> "Goes negative"</strong>
            (red) if the balance actually dips below $0.
          </li>
          <li>
            "Lowest safe to spend" applies your reserves to that low; "lowest in the
            bank" is the raw balance. <strong>"Cash lasts (if income stops)"</strong>
            counts days until your spendable cash would fall to your buffer floor
            (not all the way to $0) if no more money came in — the same
            untouchable line the rest of the app protects.
          </li>
          <li>
            On the <strong>next-paycheck</strong> view it splits where you land into
            two: <strong>"right before payday"</strong> (all your spending done, the
            paycheck not in yet — your real "will I make it?" number) and
            <strong> "after your paycheck lands"</strong> (where you restart). So an
            incoming paycheck can't make a spent-down balance look flush.
          </li>
          <li>
            <strong>Paychecks that land early are handled automatically.</strong> Your
            pay often posts a day or two before its scheduled date — and it can arrive
            from a payroll company whose name looks nothing like your job. The app
            learns which deposit is your paycheck from your own history, so when it
            lands early the forecast knows that paycheck already arrived: it won't
            count it twice, and it rolls "next paycheck" forward to the real next one.
            (It recognizes your pay by who sends it, never by the dollar amount, so a
            random deposit the same size can't be mistaken for your paycheck.)
          </li>
          <li>
            The <strong>Spent this month</strong> tile shows a small line of your
            spending climbing through the month — the dotted part is where this
            pace lands you by month-end.
          </li>
          <li>
            The <strong>cash-flow calendar</strong> tile covers the next 30 days of
            scheduled money in and out — everyday spending isn't shown there, just
            the discrete events. On a computer it's a real month grid (hover a day
            for details); on the phone it's a day-by-day list.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Insights',
    body: (
      <>
        <ul>
          <li>
            <strong>Where it goes</strong> — spending by category (tap a slice to
            see the purchases), month-by-month totals, top merchants. Spending
            totals count money out only — deposits are income, never negative
            spending. When you're viewing <strong>this or last month</strong>, each
            category also shows <strong>how it's tracking against its budget</strong>
            ("42% of $190 budget," "over $150 budget," or "no budget set") — so you
            can see where your money's going and whether it's within plan in one
            place. (Longer ranges hide this, since a monthly limit can't be compared
            to a multi-month total.) <strong>Transfers</strong> (moving your own money
            between accounts) and <strong>debt payments</strong> are left out of
            spending here — a transfer isn't an expense, and debt is tracked on the
            Debt tile — so "Where it goes" is only your real spending.
          </li>
          <li>
            <strong>Clean category names, automatically.</strong> Your bank labels
            purchases with ugly codes like "FOOD_AND_DRINK." The app now cleans those
            into real names everywhere — groceries and restaurants are split into
            <strong> Groceries</strong> and <strong>Dining</strong>, "TRANSPORTATION"
            reads "Gas," and so on. Those cleaned names are what your budgets match
            on, so a "Groceries" budget fills from your grocery runs even while the
            bank's raw code is still attached. To override any one, use the category
            dropdown on the <strong>Transactions</strong> page — and if you keep
            renaming a merchant the same way, the app learns it (see the Bills /
            Transactions notes). It also remembers your fixes going forward.
          </li>
          <li>
            <strong>Budgets</strong> — set a monthly limit per category. Tap
            <strong> Edit</strong> (top-right of the "This month vs budget" card): you
            pick the category from <strong>your own spending categories</strong> — the
            exact same names the app files your purchases under — so a budget always
            <strong> matches your real spending</strong> instead of a name that catches
            nothing. It even lists the categories you're spending in but haven't
            budgeted yet (with the amount) — tap one to budget it in a second. Every
            budget shows a bar — <strong>green</strong> under, <strong>amber</strong>
            close, <strong>red</strong> over. These budgets do two jobs: they benchmark
            your actual spending (and show per-category in <strong>Where it goes</strong>),
            <strong> and</strong> they're what gets held out of your Safe to spend and
            folded into New Normal. <strong>Rename a whole category right here</strong> — in the
            Edit panel, tap a category name and type a new one. It renames the
            <strong> whole category</strong>: the budget <em>and</em> every transaction
            filed under it, so your spending follows the new name everywhere (Where it
            goes, totals, all of it). And it <strong>sticks for good</strong> — every
            future transaction, even from a brand-new merchant the app has never seen,
            shows your name automatically. Nothing to check, ever. No
            transaction-hunting.
          </li>
          <li>
            <strong>What if?</strong> — a quick one-off check: try "an extra $400
            gig" or "$100/mo more at debt" and instantly see the effect on Safe to
            spend and your debt-free date. Nothing is saved.
          </li>
          <li>
            <strong>New Normal</strong> — model a bigger life change, like moving or
            a raise. It starts from a <strong>steady baseline</strong>: your regular
            paycheck minus recurring bills, everyday spending (your budgets), debt
            payments, and goal set-asides — all per paycheck, so it
            <strong> doesn't matter where you are in the current pay cycle</strong> or
            what you've already spent. Then add as many <strong>income</strong>,
            <strong> expense</strong>, or <strong>spend-less</strong> lines as you want
            (pick a label, an amount, and how often — /mo, /2 wks, /wk):
            <strong> + Add income</strong>, <strong>+ Add expense</strong>, and
            <strong> + Spend less</strong> — that last one models
            <strong> cutting your spending</strong> by an amount (say $200/mo less on
            dining), which pushes the number back up the same way income does. It
            shows your <strong>new safe-to-spend per paycheck</strong>. The
            <strong> ● Goals</strong> and <strong>● Debt</strong> chips let you drop
            either from the baseline — so you can see the picture <em>during</em> a
            goal, or <em>after</em> it's funded / a debt's paid off. It also walks
            your <strong>next few paycheck cycles</strong> and flags any that would
            run <strong>Tight</strong> or <strong>Short</strong>. Nothing is saved.
          </li>
          <li>
            <strong>Debt payoff plan</strong>, <strong>subscriptions &amp;
            recurring</strong>, <strong>unusual charges</strong>, and
            <strong> net worth over time</strong> all live here too.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Make it yours (layout & themes)',
    body: (
      <>
        <ul>
          <li>
            <strong>Rearrange any page</strong> — tap the sliders icon (bottom of
            the sidebar on a computer, top bar on the phone), then just
            <strong> drag tiles</strong> where you want them — any column, any
            spot. On the phone, press and hold a tile, then drag. Tap it again
            when done. Each page and screen size saves its own layout.
          </li>
          <li>
            Columns adapt to your screen: one on the phone, two on a laptop,
            three on a big monitor, four on a very wide one.
          </li>
          <li>
            <strong>Auto-arrange (close gaps)</strong> — while rearranging, tap
            this and the app repacks your tiles by their real size, so a tall
            one and a short one balance out instead of leaving an empty stretch
            under a shorter column. It keeps roughly the order you had, it just
            tidies up the leftover space.
          </li>
          <li>
            <strong>Text size</strong> (Settings → Dashboard) — pick Small to Extra
            large for computer screens; everything scales in proportion.
          </li>
          <li>
            <strong>Compact layout</strong> (Settings → Dashboard) tightens the
            cards so more fits on screen.
          </li>
          <li>
            <strong>Collapse a tile</strong> with its ⌄ while customizing. Collapsed
            tiles become slim bars — tap one anytime to reopen it.
          </li>
          <li><strong>Themes</strong> — pick a look in Settings → Theme.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Notifications',
    body: (
      <>
        <ul>
          <li>
            On iPhone: first add the app to your home screen (Share → Add to Home
            Screen), open it from there, then turn on notifications in Settings.
          </li>
          <li>
            Alerts: bill due soon (skips ones you've already paid), safe-to-spend
            getting low, paycheck expected, budget running low, and a Sunday
            <strong> weekly money recap</strong> (spent, in, net, what's coming).
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Grok (chat)',
    body: (
      <>
        <p>
          Grok can talk to this app the same way it talks to Gmail — through the
          <strong> Matt's Money</strong> connector. It reads live numbers. It only
          changes something after you say yes in that chat.
        </p>
        <ul>
          <li>
            Add it once at grok.com/connectors (Custom connector, Matt's Money).
            After that, any normal Grok chat can use it. You do not paste GitHub
            or Vercel again for new chats.
          </li>
          <li>
            <strong>Read:</strong> cash, cards, debts, bills, goals, income,
            set-asides, recent purchases, budgets, credit scores, phases, buffer,
            and Safe to spend — including a debt's first payment date, next due,
            and whether it's not-started-yet, due, or late.
          </li>
          <li>
            <strong>Change (after you say yes):</strong> log or edit purchases;
            add/edit/delete bills, income, accounts, goals, cards, and debts
            (including first payment date); set-asides; buffer; category budgets;
            credit scores.
          </li>
          <li>
            Grok does not log into your bank. Bank feeds stay on the Finance /
            SoFi connector. This app is the plan on top.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Google Calendar sync',
    body: (
      <>
        <ul>
          <li>
            Connect your Google account in Settings → Google Calendar, then choose
            either direction (or both):
          </li>
          <li>
            <strong>Push to Google Calendar</strong> — your bills, paydays, and
            phase changes appear as events on your calendar, so money dates show up
            where you already look.
          </li>
          <li>
            <strong>Pull from Google Calendar</strong> — your upcoming calendar
            events show inside the app, next to your money picture.
          </li>
          <li>
            <strong>Sync now</strong> forces an immediate refresh; otherwise it
            syncs on its own.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Your data & backup',
    body: (
      <>
        <ul>
          <li>
            <strong>Download backup</strong> (Settings → Your data) saves everything
            — accounts, transactions, goals, debts, bills, income — as one file you
            keep. Do it every month or two.
          </li>
          <li>
            Transactions can also be exported as CSV or PDF from the Transactions
            page.
          </li>
          <li>
            Offline? The app shows your last synced numbers with an amber banner and
            refreshes when you're back.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'When a number looks wrong',
    body: (
      <>
        <ul>
          <li>
            <strong>App looks out of date, or a number won't update</strong> — an
            app you added to your home screen can keep running an older saved copy
            of itself, so the screen shows numbers from old math. Go to Settings →
            Account and tap <strong>"Update now"</strong> — it wipes the saved copy
            and reloads the very latest. The <strong>"App version"</strong> and
            <strong> "Data as of"</strong> lines right there tell you how fresh the
            app and your numbers are, so you can always check.
          </li>
          <li>
            <strong>Balance looks stale</strong> — tap ↻ on the Accounts tile.
            Capital One lags hours behind sometimes; SoFi is near-instant.
          </li>
          <li>
            <strong>A bill you paid still shows</strong> — the app releases it when
            the payment appears in your bank feed with a recognizable name. If the
            bank names it weirdly, the hold clears on its own after the due date. It
            errs on the careful side — it will never show money as spendable that
            might be spoken for.
          </li>
          <li>
            <strong>Safe to spend seems low</strong> — check the breakdown right
            under the number; it lists exactly what's being held back and why.
            A loan with a first payment still ahead will hold that payment even
            though it isn't late yet.
          </li>
          <li>
            <strong>A transaction seems to be missing</strong> — the app
            automatically merges what look like duplicate imports of the same
            purchase (a clean name and a raw bank descriptor for the same
            charge, same day, same amount). It's usually right, but it's a
            best guess — if two genuinely separate purchases at the same place
            on the same day for the same amount got collapsed into one, add
            the missing one back manually.
          </li>
        </ul>
      </>
    ),
  },
]

function Section({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 py-2.5 text-left"
      >
        <span className="text-sm font-medium text-slate-700">{title}</span>
        <span
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          ⌄
        </span>
      </button>
      {open && (
        <div className="pb-3 text-sm text-slate-600 space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_p]:leading-relaxed">
          {children}
        </div>
      )}
    </div>
  )
}

export default function GuideCard() {
  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <h2 className="font-semibold text-slate-800 mb-1">How this app works</h2>
      <p className="text-xs text-slate-400 mb-2">
        The owner's manual. Tap any topic.
      </p>
      {SECTIONS.map((s) => (
        <Section key={s.title} title={s.title}>
          {s.body}
        </Section>
      ))}
    </section>
  )
}
