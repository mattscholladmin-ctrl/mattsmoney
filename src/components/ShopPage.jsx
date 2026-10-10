// @ts-nocheck
import { useState, useEffect } from 'react'

const STORAGE_KEY = 'mm.shop.v1'

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

  useEffect(() => {
    setData(loadShop())
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready) saveShop(data)
  }, [data, ready])

  function addMeal() {
    if (!input.trim()) return
    const meal = {
      id: Date.now(),
      name: input.trim(),
      ingredients: [
        { name: 'Example ingredient', qty: '1', store: 'City Market', checked: false }
      ]
    }
    setData(d => ({ ...d, meals: [...(d.meals || []), meal] }))
    setInput('')
  }

  const grocerySpend = 86.42

  if (!ready) return <div className="dw-mute">Loading shop…</div>

  return (
    <div>
      <h1 className="dw-h1">Shop</h1>
      <p className="dw-sub">Plan meals. Build the list. Send to Reminders.</p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <button className="dw-link" onClick={() => setView('hub')} style={{ padding: '6px 12px', border: '1px solid var(--dw-line)', borderRadius: 8 }}>Hub</button>
        <button className="dw-link" onClick={() => setView('meals')} style={{ padding: '6px 12px', border: '1px solid var(--dw-line)', borderRadius: 8 }}>Meals</button>
        <button className="dw-link" onClick={() => setView('list')} style={{ padding: '6px 12px', border: '1px solid var(--dw-line)', borderRadius: 8 }}>List</button>
        <button className="dw-link" onClick={() => setView('receipt')} style={{ padding: '6px 12px', border: '1px solid var(--dw-line)', borderRadius: 8 }}>Receipt</button>
      </div>

      {view === 'hub' && (
        <>
          <div className="dw-card">
            <div className="dw-k">This week</div>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMeal()}
              placeholder="What do you want to eat this week?"
              style={{ width: '100%', marginTop: 8, background: 'var(--dw-card-2)', border: '1px solid var(--dw-line)', borderRadius: 8, padding: 12, color: 'var(--dw-text)', font: 'inherit' }}
            />
          </div>
          <div className="dw-card">
            <div className="dw-k">Grocery spend</div>
            <div style={{ fontSize: '2.4rem', fontWeight: 800, margin: '8px 0' }}>${grocerySpend.toFixed(2)}</div>
            <div className="dw-mute">of $120 budget</div>
          </div>
          <div className="dw-card">
            <div className="dw-k">Shopping list</div>
            <div style={{ color: '#ff3bd4', fontWeight: 700, margin: '12px 0 6px' }}>CITY MARKET</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--dw-line)' }}>☐ Eggs (1 dozen)<span>1</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--dw-line)' }}>☐ Sourdough Bread<span>1</span></div>
            <div style={{ marginTop: 16 }}>
              <button className="dw-link" style={{ background: 'var(--dw-blue)', color: '#fff', padding: '10px 16px', borderRadius: 8, fontWeight: 600 }}>Send to Reminders</button>
            </div>
          </div>
        </>
      )}

      {view === 'meals' && (
        <div className="dw-card">
          <div className="dw-k">What do you want to eat?</div>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="spaghetti carbonara and easy chicken tacos"
            style={{ width: '100%', marginTop: 8, background: 'var(--dw-card-2)', border: '1px solid var(--dw-line)', borderRadius: 8, padding: 12, color: 'var(--dw-text)', font: 'inherit' }}
          />
          <button className="dw-link" onClick={addMeal} style={{ marginTop: 8 }}>Generate meals</button>
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
          <div className="dw-k">Store-specific list</div>
          <p className="dw-mute">Grouped by store. Check items as you shop.</p>
          <div style={{ marginTop: 12 }}>
            <div style={{ color: '#ff3bd4', fontWeight: 700 }}>CITY MARKET</div>
            <div>☐ Eggs</div>
            <div>☐ Bread</div>
            <div style={{ color: '#ff3bd4', fontWeight: 700, marginTop: 12 }}>LAGREE'S</div>
            <div>☐ Protein Powder</div>
          </div>
          <button className="dw-link" style={{ marginTop: 16, background: 'var(--dw-blue)', color: '#fff', padding: '10px 16px', borderRadius: 8 }}>Send to Reminders</button>
        </div>
      )}

      {view === 'receipt' && (
        <div className="dw-card">
          <div className="dw-k">Receipt review</div>
          <p className="dw-mute">Upload a photo to extract items and categories.</p>
          <input type="file" accept="image/*" style={{ marginTop: 12 }} />
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--dw-line)' }}>
              <span>Organic Avocados</span><span>$3.49</span><span className="dw-chip">Groceries</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--dw-line)' }}>
              <span>Paper Towels</span><span>$4.99</span><span className="dw-chip">Household</span>
            </div>
          </div>
          <button className="dw-link" style={{ marginTop: 16, background: 'var(--dw-blue)', color: '#fff', padding: '10px 16px', borderRadius: 8 }}>Confirm</button>
        </div>
      )}
    </div>
  )
}
