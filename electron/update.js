// The Software Update page's renderer (update.html): plain browser JS, allowed by the page's script-src 'self'.
// It draws what update-view.cjs returns, through window.weftUpdate (update-preload.cjs), with textContent only.
(function () {
  var api = window.weftUpdate;
  var $ = function (id) { return document.getElementById(id); };

  function draw(v) {
    document.body.dataset.tone = v.tone;
    $("title").textContent = v.title;
    $("detail").textContent = v.detail;
    $("current").textContent = v.current;
    $("latest").textContent = v.latest;
    $("latest-row").hidden = !v.latest;
    $("checked").textContent = v.checked;
    $("notes").textContent = v.notes;
    $("notes-wrap").hidden = !v.notes;
    var bar = $("buttons");
    bar.textContent = "";
    v.buttons.forEach(function (b) {
      var el = document.createElement("button");
      el.type = "button";
      el.textContent = b.label;
      el.disabled = Boolean(b.disabled);
      if (b.primary) el.className = "primary";
      el.addEventListener("click", function () { api.act(b.action); });
      bar.appendChild(el);
    });
  }

  api.onChange(draw);
  api.view().then(draw);
  // "Checked 5 min ago" stays current while the window is open.
  setInterval(function () { api.view().then(draw); }, 60000);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") api.act("close");
  });
})();
