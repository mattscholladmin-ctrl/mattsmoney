// @ts-nocheck
import { useState, useEffect } from 'react'

const STORAGE_KEY = 'mm.shop.v1'
const STORES = ['City Market', 'Safeway', 'Walmart', 'Target', 'Amazon', "LaGree's", 'Natural Grocers']

function loadShop() {
  if (typeof window === 'undefined') return { meals: [], list: [], staples: [], receipts: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : { meals: [], list: [], staples: [], receipts: [] }
  } catch {
    return { meals: [], list: [], staples: [], receipts: [] }
  }
}

function saveShop(data) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

export default function ShopPage() {
  const [data, setData] = useState({ meals: [], list: [], staples: [], receipts: [] })
  const [input, setInput] = useState('')
  const [view, setView] = useState('hub')
  const [ready, setReady] = useState(false)
  const [stapleInput, setStapleInput] = useState('')

  useEffect(() => {
    setData(loadShop())
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready) saveShop(data)
  }, [data, ready])

  function generateFromMeals() {
    if (!input.trim()) return
    // Simple placeholder generation — real version would call a model or recipe lookup
    const names = input.split(/and|,/i).map(s => s.trim()).filter(Boolean)
    const newMeals = names.map(name => ({
      id: Date.now() + Math.random(),
      name,
      ingredients: [
        { name: 'Ingredient A', qty: '1', store: 'City Market', checked: false },
        { name: 'Ingredient B', qty: '2', store: "LaGree's", checked: false },
      ]
    }))
    const newItems = newMeals.flatMap(m => m.ingredients.map(ing => ({ ...ing, meal: m.name })))
    // Merge into list grouped by store, skip if already in staples
    const stapleNames = new Set((data.staples || []).map(s => s.toLowerCase()))
    setData(d => {
      const list = [...(d.list || [])]
      for (const item of newItems) {
        if (stapleNames.has(item.name.toLowerCase())) continue
        let group = list.find(g => g.store === item.store)
        if (!group) {
          group = { store: item.store, items: [] }
          list.push(group)
        }
        if (!group.items.some(i => i.name === item.name)) {
          group.items.push({ name: item.name, qty: item.qty, checked: false })
        }
      }
      return { ...d, meals: [...(d.meals || []), ...newMeals], list }
    })
    setInput('')
  }

  function toggleChecked(store, idx) {
    setData(d => {
      const list = d.list.map(g => g.store === store
        ? { ...g, items: g.items.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it) }
        : g
      )
      return { ...d, list }
    })
  }

  function addStaple() {
    if (!stapleInput.trim()) return
    setData(d => ({ ...d, staples: [...(d.staples || []), stapleInput.trim()] }))
    setStapleInput('')
  }

  function sendToReminders() {
    const items = (data.list || []).flatMap(g => g.items.filter(i => !i.checked).map(i => `${i.qty} ${i.name} (${g.store})`))
    const text = items.join('\n')
    if (!text) return alert('List is empty')
    // For Shortcut: copy text or open a data URL the Shortcut can read
    navigator.clipboard.writeText(text).then(() => {
      alert('List copied. Run your Reminders Shortcut to import it.')
    }).catch(() => {
      prompt('Copy this list for your Shortcut:', text)
    })
  }

  const grocerySpend = 86.42 // TODO: wire to real transactions

  if (!ready) return <div className="dw-mute">Loading shop…</div>

  return (
    <div>
      <h1 className="dw-h1">Shop</h1>
      <p className="dw-sub">Plan meals. Build the list. Send to Reminders.</p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap' }}>
        {['hub', 'meals', 'list', 'staples', 'receipt'].map(v => (
          <button key={v} className="dw-link" onClick={() => setView(v)} style={{ padding: '6px 12px', border: '1px solid var(--dw-line)', borderRadius: 8, textTransform: 'capitalize' }}>{v}</button>
        ))}
      </div>

      {view === 'hub' && (
        <>
          <div className="dw-card">
            <div className="dw-k">This week</div>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && generateFromMeals()}
              placeholder="What do you want to eat this week?"
              style={{ width: '100%', marginTop: 8, background: 'var(--dw-card-2)', border: '1px solid var(--dw-line)', borderRadius: 8, padding: 12, color: 'var(--dw-text)', font: 'inherit' }}
            />
            <button className="dw-link" onClick={generateFromMeals} style={{ marginTop: 8 }}>Add meals</button>
          </div>
          <div className="dw-card">
            <div className="dw-k">Grocery spend</div>
            <div style={{ fontSize: '2.4rem', fontWeight: 800, margin: '8px 0' }}>${grocerySpend.toFixed(2)}</div>
            <div className="dw-mute">of $120 budget</div>
          </div>
          <div className="dw-card">
            <div className="dw-k">Shopping list preview</div>
            {(data.list || []).length === 0 && <p className="dw-mute">No items yet.</p>}
            {(data.list || []).map(g => (
              <div key={g.store}>
                <div style={{ color: '#ff3bd4', fontWeight: 700, margin: '12px 0 6px' }}>{g.store}</div>
                {g.items.slice(0, 3).map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>{it.checked ? '☑' : '☐'} {it.name}</span><span>{it.qty}</span>
                  </div>
                ))}
              </div>
            ))}
            <button className="dw-link" onClick={sendToReminders} style={{ marginTop: 16, background: 'var(--dw-blue)', color: '#fff', padding: '10px 16px', borderRadius: 8, fontWeight: 600 }}>Send to Reminders</button>
          </div>
        </>
      )}

      {view === 'meals' && (
        <div className="dw-card">
          <div className="dw-k">Meals</div>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="spaghetti carbonara and easy chicken tacos"
            style={{ width: '100%', marginTop: 8, background: 'var(--dw-card-2)', border: '1px solid var(--dw-line)', borderRadius: 8, padding: 12, color: 'var(--dw-text)', font: 'inherit' }}
          />
          <button className="dw-link" onClick={generateFromMeals} style={{ marginTop: 8 }}>Generate</button>
          {(data.meals || []).map(m => (
            <div key={m.id} style={{ marginTop: 16, padding: 12, border: '1px solid var(--dw-line)', borderRadius: 12 }}>
              <b>{m.name}</b>
              {(m.ingredients || []).map((ing, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>☐ {ing.qty} {ing.name}</span>
                  <span className="dw-mute">{ing.store}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {view === 'list' && (
        <div className="dw-card">
          <div className="dw-k">Shopping list</div>
          {(data.list || []).length === 0 && <p className="dw-mute">No items. Add meals first.</p>}
          {(data.list || []).map(g => (
            <div key={g.store} style={{ marginBottom: 16 }}>
              <div style={{ color: '#ff3bd4', fontWeight: 700, marginBottom: 6 }}>{g.store}</div>
              {g.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--dw-line)' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={it.checked} onChange={() => toggleChecked(g.store, i)} />
                    {it.name}
                  </label>
                  <span>{it.qty}</span>
                </div>
              ))}
            </div>
          ))}
          <button className="dw-link" onClick={sendToReminders} style={{ marginTop: 8, background: 'var(--dw-blue)', color: '#fff', padding: '10px 16px', borderRadius: 8 }}>Send to Reminders</button>
        </div>
      )}

      {view === 'staples' && (
        <div className="dw-card">
          <div className="dw-k">Staples baseline</div>
          <p className="dw-mute">Things you normally keep on hand. Meal planner skips these.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={stapleInput} onChange={e => setStapleInput(e.target.value)} placeholder="e.g. olive oil" style={{ flex: 1, background: 'var(--dw-card-2)', border: '1px solid var(--dw-line)', borderRadius: 8, padding: 8, color: 'var(--dw-text)' }} />
            <button className="dw-link" onClick={addStaple}>Add</button>
          </div>
          <ul style={{ marginTop: 12 }}>
            {(data.staples || []).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {view === 'receipt' && (
        <div className="dw-card">
          <div className="dw-k">Receipt upload</div>
          <p className="dw-mute">Photo → extract items → categorize → confirm. (OCR wiring next)</p>
          <input type="file" accept="image/*" style={{ marginTop: 12 }} />
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--dw-line)' }}>
              <span>Example item</span><span>$3.49</span><span className="dw-chip">Groceries</span>
            </div>
          </div>
          <button className="dw-link" style={{ marginTop: 16, background: 'var(--dw-blue)', color: '#fff', padding: '10px 16px', borderRadius: 8 }}>Confirm</button>
        </div>
      )}
    </div>
  )
}
