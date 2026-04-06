(async () => {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const members = new Map();

  // ── Helper: extract emoji+text from a node ──────────────────────────────
  const getFullText = (el) => {
    if (!el) return "";
    let out = "";
    el.childNodes.forEach(n => {
      if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
      else if (n.tagName === "IMG" && n.dataset.plainText) out += n.dataset.plainText;
      else if (n.tagName) out += getFullText(n);
    });
    return out.trim();
  };

  // ── Find the real scrollable container ──────────────────────────────────
  // WhatsApp uses a virtualised list — find parent of listitems that is scrollable
  const findScrollContainer = () => {
    const item = document.querySelector('[role="listitem"]');
    if (!item) return null;
    let el = item.parentElement;
    while (el) {
      const style = window.getComputedStyle(el);
      const overflow = style.overflow + style.overflowY;
      if (overflow.includes("scroll") || overflow.includes("auto")) return el;
      el = el.parentElement;
    }
    return null;
  };

  // ── Extract from all currently rendered listitems ────────────────────────
  const extract = () => {
    document.querySelectorAll('[role="listitem"]').forEach(item => {
      try {
        // ── Name: from title attribute of the name span ───────────────────
        const nameSpan = item.querySelector('span[dir="auto"][title]');
        const rawTitle = nameSpan?.getAttribute("title") || "";

        // ── Phone: check aria-label too (has "Maybe +91..." format sometimes)
        const ariaLabel = nameSpan?.getAttribute("aria-label") || "";

        // ── Phone from gridcell aria-colindex="1" → span._ajzr ───────────
        // This is the RIGHT column where WA puts the number for ~ contacts
        const phoneCell = item.querySelector('[role="gridcell"][aria-colindex="1"]');
        const phoneCellText = phoneCell ? getFullText(phoneCell).trim() : "";

        const phoneRegex = /\+?[\d][\d\s\-().]{8,18}/;

        // Determine name and phone
        let name = "";
        let phone = "";

        // Case 1: title is a phone number (pure unsaved contact, no custom name)
        if (phoneRegex.test(rawTitle) && rawTitle.replace(/\D/g, "").length >= 8) {
          phone = rawTitle.trim();
          name = "";
        }
        // Case 2: title starts with "~ " = unsaved contact with WhatsApp name
        else if (rawTitle.startsWith("~")) {
          name = rawTitle.replace(/^~\s*/, "").trim();
        }
        // Case 3: saved contact with proper name
        else {
          name = rawTitle.trim();
        }

        // Phone from right-column cell (most reliable for ~ contacts)
        if (!phone && phoneCellText && phoneRegex.test(phoneCellText)) {
          phone = phoneCellText;
        }

        // Phone from aria-label fallback ("Maybe +91...")
        if (!phone) {
          const ariaMatch = ariaLabel.match(/\+[\d\s\-().]{8,}/);
          if (ariaMatch) phone = ariaMatch[0].trim();
        }

        const key = phone || name;
        if (!key) return;

        // ── Profile image ─────────────────────────────────────────────────
        const img = item.querySelector('img[src*="pps.whatsapp.net"]');
        const profileImg = img ? img.src : "";

        // ── Description ───────────────────────────────────────────────────
        const descSpan = item.querySelector('span[data-testid="selectable-text"][title]');
        const description = descSpan?.getAttribute("title")?.trim() || "";

        // ── Admin ─────────────────────────────────────────────────────────
        const isAdmin = [...item.querySelectorAll("div")]
          .some(d => d.children.length === 0 && d.textContent.trim() === "Group admin");

        if (!members.has(key)) {
          members.set(key, { name, phone, description, profileImg, isAdmin });
        } else {
          const m = members.get(key);
          if (!m.phone && phone) m.phone = phone;
          if (!m.profileImg && profileImg) m.profileImg = profileImg;
          if (!m.description && description) m.description = description;
          if (!m.isAdmin && isAdmin) m.isAdmin = true;
          if (!m.name && name) m.name = name;
        }
      } catch (_) {}
    });
  };

  // ── Find container and verify ─────────────────────────────────────────────
  const container = findScrollContainer();
  if (!container) {
    alert("❌ Scrollable container not found!\nMake sure group info panel is open with members list visible.");
    return;
  }

  const totalHeight = container.scrollHeight;
  console.log(`✅ Container found. ScrollHeight: ${totalHeight}px`);
  console.log("⏳ Starting extraction — do NOT click anything...");

  // ── Scroll from TOP to BOTTOM in steps ───────────────────────────────────
  container.scrollTop = 0;
  await delay(800);

  let lastScrollTop = -1;
  let noMoveCount = 0;

  while (noMoveCount < 5) {
    extract();

    container.scrollTop += 400; // small steps = more overlap = fewer missed items
    await delay(700);           // wait for virtual DOM re-render

    const current = Math.round(container.scrollTop);
    if (current === lastScrollTop) {
      noMoveCount++;
    } else {
      noMoveCount = 0;
      lastScrollTop = current;
      const pct = Math.min(100, Math.round((current / container.scrollHeight) * 100));
      console.log(`📋 ${members.size} members | scroll ${pct}%`);
    }
  }

  extract(); // final pass at bottom
  console.log(`\n✅ Done! Total unique members: ${members.size}`);

  // ── Build and download CSV ────────────────────────────────────────────────
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Name", "Phone", "Description", "Profile Image URL", "Is Admin"].join(",")];

  members.forEach(({ name, phone, description, profileImg, isAdmin }) => {
    lines.push([
      esc(name || "(unsaved)"),
      esc(phone),
      esc(description),
      esc(profileImg),
      isAdmin ? "Yes" : "No"
    ].join(","));
  });

  const csv = "\uFEFF" + lines.join("\n"); // BOM for Excel UTF-8 support
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `wa_members_${Date.now()}.csv`
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  console.log("📥 CSV downloaded!");
  console.table([...members.values()].slice(0, 15));
})();
