import { Controller, Get, Header, Param } from '@nestjs/common';

/**
 * Page de paiement publique : HTML + CSS + JS en ligne, sans framework ni ressource externe.
 * Objectif cahier des charges : < 150 Ko, affichage < 3 s en 3G. Ici ≈ 12 Ko.
 * Le jeton n'est jamais interprété côté serveur dans le HTML (aucune injection possible) :
 * le script le lit dans l'URL et appelle l'API publique.
 */
@Controller('p')
export class PayPageController {
  @Get(':token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Frame-Options', 'DENY')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
  )
  page(@Param('token') _token: string) {
    return PAGE;
  }
}

const PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Payer ma dette · L'Ardoise</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#18222a;--slate:#1f2d35;--orange:#ea580c;--paper:#faf8f4;--line:#e3ded3;--muted:#6b747a;--green:#15803d;--red:#b91c1c}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased}
main{max-width:440px;margin:0 auto;padding:20px 16px 32px;display:flex;flex-direction:column;gap:16px;min-height:100vh}
.shop{display:flex;align-items:center;gap:12px}
.av{width:44px;height:44px;border-radius:14px;background:var(--slate);color:#fb923c;font-weight:800;display:flex;align-items:center;justify-content:center}
.card{background:#fff;border:1px solid #ece7dd;border-radius:20px;padding:16px}
.big{font-size:32px;font-weight:800;letter-spacing:-.02em}
.big small{font-size:15px;color:#8a9399;font-weight:600}
.muted{color:var(--muted);font-size:13px}
h2{font-size:15px;font-weight:700}
.row{display:flex;gap:8px}
.opt{flex:1;border:1.5px solid var(--line);background:#fff;border-radius:16px;padding:12px 14px;text-align:left;font:inherit;color:inherit;cursor:pointer;display:flex;align-items:center;gap:10px}
.opt[aria-pressed=true]{border-color:var(--slate);box-shadow:0 0 0 3px rgba(31,45,53,.08)}
.opt .k{display:block;font-size:12px;color:var(--muted)}
.mtn,.om{width:40px;height:28px;border-radius:8px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}
.mtn{background:#ffcb05;color:#1a1a1a}.om{background:#ff7900;color:#fff}
input{width:100%;height:52px;border-radius:14px;border:1.5px solid var(--line);background:#fff;padding:0 14px;font:inherit;font-size:16px}
input:focus{outline:none;border-color:var(--slate)}
.btn{height:52px;border:0;border-radius:16px;background:var(--orange);color:#fff;font:inherit;font-weight:700;font-size:16px;cursor:pointer;width:100%}
.btn:disabled{opacity:.5}
.ghost{background:#f0ece3;color:var(--slate)}
.err{color:var(--red);font-size:13px;min-height:18px}
.center{text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center}
.ring{width:96px;height:96px;border-radius:48px;display:flex;align-items:center;justify-content:center;font-size:40px}
.kv{display:flex;justify-content:space-between;font-size:14px;padding:10px 0;border-bottom:1px dashed var(--line)}
.kv:last-child{border:0}.kv span{color:var(--muted)}
.foot{margin-top:auto;font-size:11px;color:var(--muted);text-align:center}
.hidden{display:none!important}
.stop{background:none;border:0;color:var(--muted);font:inherit;font-size:12px;text-decoration:underline;cursor:pointer;padding:8px;align-self:center}
</style></head>
<body><main>
<div class="shop"><div class="av" id="ini">·</div><div><b id="shop">Chargement…</b><div class="muted">Paiement de votre ardoise</div></div></div>

<section id="v-form" class="hidden">
  <div class="card"><div class="muted" id="hello"></div><div class="big" id="bal"></div><div class="muted" id="recent"></div></div>
  <h2 style="margin-top:16px">Combien voulez-vous payer ?</h2>
  <div class="row" style="margin-top:8px">
    <button class="opt" id="all" aria-pressed="true" type="button"><span><span class="k">Tout</span><b id="allAmt"></b></span></button>
    <button class="opt" id="part" aria-pressed="false" type="button"><span><span class="k">Une partie</span><b>Montant…</b></span></button>
  </div>
  <input id="amount" class="hidden" inputmode="numeric" placeholder="Montant en FCFA" style="margin-top:8px" aria-label="Montant">
  <h2 style="margin-top:16px">Payer avec</h2>
  <div class="row" style="margin-top:8px">
    <button class="opt" id="op-MTN" aria-pressed="false" type="button"><span class="mtn">MoMo</span><b>MTN</b></button>
    <button class="opt" id="op-ORANGE" aria-pressed="false" type="button"><span class="om">OM</span><b>Orange</b></button>
  </div>
  <input id="phone" inputmode="tel" autocomplete="tel" placeholder="6 77 12 34 56" style="margin-top:8px" aria-label="Numéro Mobile Money">
  <p class="err" id="err" role="alert"></p>
  <button class="btn" id="pay" type="button">Payer</button>
</section>

<section id="v-wait" class="hidden center" style="gap:14px;margin-top:12px">
  <div class="ring" style="background:#fef3c7">📱</div>
  <h2 style="font-size:22px">Validez sur votre téléphone</h2>
  <p class="muted" id="waitTxt"></p>
  <p class="muted" id="countdown"></p>
  <button class="btn ghost" id="again" type="button" style="margin-top:12px">Je n'ai rien reçu</button>
</section>

<section id="v-done" class="hidden" style="display:flex;flex-direction:column;gap:14px">
  <div class="center"><div class="ring" style="background:#dcfce7;color:var(--green)">✓</div>
  <div class="muted">Paiement reçu</div><div class="big" id="paid"></div></div>
  <div class="card" id="receipt"></div>
</section>

<section id="v-ko" class="hidden center" style="gap:12px;margin-top:12px">
  <div class="ring" style="background:#fee2e2;color:var(--red)">✕</div>
  <h2 id="koTitle">Paiement non abouti</h2><p class="muted">Aucun montant n'a été débité. Vous pouvez réessayer.</p>
  <button class="btn" id="retry" type="button">Réessayer</button>
</section>

<section id="v-gone" class="hidden center" style="margin-top:24px"><h2>Lien indisponible</h2><p class="muted" id="goneTxt"></p></section>

<button class="stop hidden" id="stop" type="button">Ne plus recevoir de rappels</button>
<p class="muted hidden" id="stopped" role="status" style="text-align:center;font-size:13px"></p>
<p class="foot">🔒 Paiement sécurisé · aucun compte requis · L'Ardoise</p>
</main>
<script>
(function(){
  var token = location.pathname.split('/').filter(Boolean).pop();
  var api = '/public/links/' + encodeURIComponent(token);
  var $ = function(id){ return document.getElementById(id); };
  var fmt = function(n){ return new Intl.NumberFormat('fr-FR').format(n) + ' FCFA'; };
  var st = { balance: 0, min: 100, op: null, partial: false, tx: null, timer: null, deadline: 0 };
  function show(v){ ['form','wait','done','ko','gone'].forEach(function(x){ $('v-'+x).classList.toggle('hidden', x!==v); }); }
  function text(el, t){ el.textContent = t; }
  function setOp(op){ st.op = op; ['MTN','ORANGE'].forEach(function(o){ $('op-'+o).setAttribute('aria-pressed', String(o===op)); }); }
  function json(r){ return r.json().then(function(b){ if(!r.ok){ var m = b && b.message; throw new Error(Array.isArray(m) ? m[0] : (m || 'Erreur')); } return b; }); }

  function load(){
    fetch(api).then(json).then(function(d){
      st.balance = d.balance; st.min = d.minAmount;
      text($('shop'), d.shopName); text($('ini'), d.shopName.split(/\\s+/).slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase());
      text($('hello'), 'Bonjour ' + d.customerFirstName + ', votre solde');
      $('bal').innerHTML = ''; $('bal').append(new Intl.NumberFormat('fr-FR').format(d.balance) + ' ');
      var s = document.createElement('small'); s.textContent = 'FCFA'; $('bal').append(s);
      text($('recent'), d.recent.length ? d.recent.length + (d.recent.length > 1 ? ' opérations récentes' : ' opération récente') : '');
      text($('allAmt'), fmt(d.balance)); text($('pay'), 'Payer ' + fmt(d.balance));
      if (d.suggestedOperator) setOp(d.suggestedOperator);
      $('stop').classList.remove('hidden');
      if (d.balance <= 0) { show('gone'); text($('goneTxt'), 'Votre ardoise est à jour, rien à payer. Merci !'); return; }
      show('form');
    }).catch(function(e){ show('gone'); text($('goneTxt'), e.message); $('stop').classList.remove('hidden'); });
  }

  // Désinscription des rappels automatiques : marche aussi quand le lien a expiré.
  $('stop').onclick = function(){
    if (!confirm('Ne plus recevoir les rappels automatiques de cette boutique ?')) return;
    $('stop').disabled = true;
    fetch(api + '/opt-out', { method:'POST' }).then(json).then(function(){
      $('stop').classList.add('hidden'); $('stopped').classList.remove('hidden');
      text($('stopped'), 'C’est noté : vous ne recevrez plus de rappels automatiques. Vous pouvez toujours payer ici.');
    }).catch(function(e){ $('stop').disabled = false; alert(e.message); });
  };

  function amount(){ return st.partial ? parseInt(($('amount').value || '').replace(/\\D/g,''), 10) : st.balance; }
  function refreshBtn(){ var a = amount(); text($('pay'), 'Payer ' + (a > 0 ? fmt(a) : '')); }
  $('all').onclick = function(){ st.partial = false; $('all').setAttribute('aria-pressed','true'); $('part').setAttribute('aria-pressed','false'); $('amount').classList.add('hidden'); refreshBtn(); };
  $('part').onclick = function(){ st.partial = true; $('part').setAttribute('aria-pressed','true'); $('all').setAttribute('aria-pressed','false'); $('amount').classList.remove('hidden'); $('amount').focus(); refreshBtn(); };
  $('amount').oninput = refreshBtn;
  $('op-MTN').onclick = function(){ setOp('MTN'); };
  $('op-ORANGE').onclick = function(){ setOp('ORANGE'); };

  $('pay').onclick = function(){
    var a = amount(); text($('err'), '');
    if (!st.op) return text($('err'), 'Choisissez MTN ou Orange');
    if (!a || a < st.min) return text($('err'), 'Montant minimum : ' + fmt(st.min));
    if (a > st.balance) return text($('err'), 'Montant maximum : ' + fmt(st.balance));
    $('pay').disabled = true;
    fetch(api + '/payments', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount:a, phone:$('phone').value, operator:st.op }) })
      .then(json).then(function(tx){
        st.tx = tx; if (tx.status === 'FAILED') return show('ko');
        var code = st.op === 'MTN' ? '*126#' : '#150#';
        text($('waitTxt'), 'Une demande de ' + fmt(a) + ' a été envoyée. Entrez votre code PIN Mobile Money, ou composez ' + code + '.');
        st.deadline = Date.now() + 15*60*1000; show('wait'); poll();
      }).catch(function(e){ text($('err'), e.message); })
      .then(function(){ $('pay').disabled = false; });
  };

  function poll(){
    clearTimeout(st.timer);
    var left = Math.max(0, st.deadline - Date.now());
    text($('countdown'), 'Expire dans ' + Math.floor(left/60000) + ':' + String(Math.floor(left/1000)%60).padStart(2,'0'));
    fetch(api + '/payments/' + st.tx.id).then(json).then(function(t){
      if (t.status === 'SUCCESS') return done(t);
      if (t.status === 'FAILED' || t.status === 'EXPIRED') { text($('koTitle'), t.status === 'EXPIRED' ? 'Demande expirée' : 'Paiement refusé'); return show('ko'); }
      st.timer = setTimeout(poll, left > 0 ? 3000 : 15000);
    }).catch(function(){ st.timer = setTimeout(poll, 5000); });
  }

  function done(t){
    show('done'); text($('paid'), fmt(t.amount));
    var r = $('receipt'); r.innerHTML = '';
    [['Reçu n°', t.receipt ? t.receipt.number : '—'], ['Boutique', $('shop').textContent], ['Moyen', t.operator === 'MTN' ? 'MTN MoMo' : 'Orange Money'],
     ['Date', new Date().toLocaleString('fr-FR')], ['Solde restant', t.receipt ? fmt(t.receipt.balanceAfter) : '—']].forEach(function(kv){
      var d = document.createElement('div'); d.className = 'kv'; var a = document.createElement('span'); a.textContent = kv[0]; var b = document.createElement('b'); b.textContent = kv[1]; d.append(a, b); r.append(d);
    });
  }

  $('again').onclick = function(){ clearTimeout(st.timer); load(); };
  $('retry').onclick = load;
  load();
})();
</script></body></html>`;
