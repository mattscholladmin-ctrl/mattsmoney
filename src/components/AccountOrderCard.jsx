// @ts-nocheck
import { useEffect, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { setAccountOrder } from '../lib/api'

// Settings card: drag accounts into the order they should appear everywhere
// (the Accounts tile, Check-in, Manage). Saved to each account's sort_order.
function Row({ account }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: account.id })
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...(isDragging ? { opacity: 0.6, position: 'relative', zIndex: 10 } : {}),
      }}
      {...attributes}
      {...listeners}
      className="flex items-center gap-2 py-2 px-2 -mx-2 rounded-lg cursor-grab active:cursor-grabbing"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-slate-300 shrink-0">
        <circle cx="9" cy="6" r="1.7" />
        <circle cx="15" cy="6" r="1.7" />
        <circle cx="9" cy="12" r="1.7" />
        <circle cx="15" cy="12" r="1.7" />
        <circle cx="9" cy="18" r="1.7" />
        <circle cx="15" cy="18" r="1.7" />
      </svg>
      <span className="text-sm text-slate-700 truncate">
        {account.name}
        {account.hidden && <span className="text-xs text-slate-300"> · hidden</span>}
      </span>
    </li>
  )
}

export default function AccountOrderCard({ accounts = [], onChanged }) {
  const [order, setOrder] = useState(() => accounts.map((a) => a.id))
  useEffect(() => {
    setOrder(accounts.map((a) => a.id))
  }, [accounts])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  )
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]))

  const [error, setError] = useState(null)
  async function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const prev = order
    const next = arrayMove(order, order.indexOf(active.id), order.indexOf(over.id))
    setOrder(next)
    setError(null)
    try {
      await setAccountOrder(next)
      onChanged()
    } catch (e) {
      setOrder(prev) // save failed — snap back so the screen matches reality
      setError(e.message || 'Could not save the new order — try again.')
    }
  }

  if (!accounts.length) return null

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <h2 className="font-semibold text-slate-800 mb-1">Account order</h2>
      <p className="text-xs text-slate-400 mb-2">
        Drag accounts into the order you want them listed everywhere.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-slate-100">
            {order.map((id) => byId[id] && <Row key={id} account={byId[id]} />)}
          </ul>
        </SortableContext>
      </DndContext>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </section>
  )
}
