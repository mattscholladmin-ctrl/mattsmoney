// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchShopping, saveShopping } from "./shop-api.js";
import { cleanShop, emptyShop } from "./shop.js";
export function useShopping(userId) {
  const cacheKey = `mm.shop.v2:${userId}`;
  const [initial] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(cacheKey) || "null") || {};
    } catch {
      return {};
    }
  });
  const [data, setData] = useState(() => cleanShop(initial.content));
  const [dirty, setDirty] = useState(Boolean(initial.dirty));
  const dirtyRef = useRef(dirty),
    dataRef = useRef(data),
    revision = useRef(Number(initial.revision || 0)),
    active = useRef(true);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [message, setMessage] = useState("Loading shopping data…");
  const read = useCallback(
    async (discard = false) => {
      try {
        const remote = await fetchShopping(userId);
        if (!active.current) return;
        if (dirtyRef.current && !discard) {
          if (Number(remote.revision) !== revision.current) {
            setConflict(true);
            setMessage(
              "Another device saved changes. Your draft is kept here; copy it if needed, then reload the account version before saving.",
            );
          }
        } else {
          setData(cleanShop(remote.content));
          dataRef.current = cleanShop(remote.content);
          dirtyRef.current = false;
          setDirty(false);
          setConflict(false);
          setMessage("Shopping data loaded from your account.");
        }
        if (!dirtyRef.current) revision.current = Number(remote.revision);
        setReady(true);
      } catch (e) {
        if (active.current)
          setMessage(`Shopping sync failed: ${e.message}. Your draft is kept on this device.`);
      }
    },
    [userId],
  );
  useEffect(() => {
    active.current = true;
    read();
    const focus = () => {
      if (!document.hidden) read();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    const timer = setInterval(focus, 30000);
    return () => {
      active.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
    };
  }, [read]);
  useEffect(() => {
    dataRef.current = data;
    dirtyRef.current = dirty;
    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ content: data, dirty, revision: revision.current }),
      );
    } catch {
      /* Account save still works. */
    }
  }, [data, dirty, cacheKey]);
  function edit(fn) {
    setData((old) => {
      const next = cleanShop(typeof fn === "function" ? fn(old) : fn);
      dataRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    setDirty(true);
    setMessage("Unsaved shopping changes. Save to sync across devices.");
  }
  async function save() {
    if (busy || !ready || !dirty || conflict) return;
    setBusy(true);
    const draft = dataRef.current;
    try {
      const remote = await saveShopping(userId, draft, revision.current);
      if (!active.current) return;
      revision.current = Number(remote.revision);
      if (JSON.stringify(draft) === JSON.stringify(dataRef.current)) {
        dirtyRef.current = false;
        setDirty(false);
        setMessage("Shopping changes saved to your account.");
      } else setMessage("Saved. Newer edits still need saving.");
    } catch (e) {
      if (e.code === "40001") setConflict(true);
      if (active.current) setMessage(`Not saved: ${e.message}. Your draft is kept on this device.`);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return { data, edit, dirty, ready, busy, conflict, message, save, reload: () => read(true) };
}
