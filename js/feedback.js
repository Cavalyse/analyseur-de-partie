// Rubrique « Bug ou idée ? » : le formulaire prépare une demande (issue) sur le dépôt GitHub du site.

const REPO = 'https://github.com/Cavalyse/analyseur-de-partie';
const MAX_PGN = 3000; // l'URL de GitHub est limitée en taille

const TYPES = {
  bug: { label: 'bug', prefix: '[Bug] ', heading: 'Description du problème' },
  idea: { label: 'enhancement', prefix: '[Idée] ', heading: 'Description de la demande' },
};

/**
 * `getGameContext` renvoie des informations sur la partie affichée (ou null),
 * jointes à la demande si l'utilisateur le souhaite.
 */
export function initFeedback(getGameContext) {
  const dialog = document.querySelector('#feedback-dialog');
  const form = document.querySelector('#feedback-form');
  const attach = document.querySelector('#feedback-attach');

  document.querySelectorAll('[data-open-feedback]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ctx = getGameContext();
      attach.closest('label').hidden = !ctx;
      attach.checked = Boolean(ctx);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      form.querySelector('#feedback-title').focus();
    });
  });
  document.querySelector('#feedback-cancel').addEventListener('click', () => dialog.close());
  document.querySelector('#feedback-issues').href = `${REPO}/issues`;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = TYPES[form.elements.type.value] || TYPES.bug;
    const title = form.elements.title.value.trim();
    const description = form.elements.description.value.trim();

    let body = `### ${type.heading}\n\n${description}\n`;
    const ctx = attach.checked ? getGameContext() : null;
    if (ctx) {
      body += '\n### Partie concernée\n\n';
      if (ctx.url) body += `- Lien : ${ctx.url}\n`;
      body += `- Joueurs : ${ctx.players}\n- Coup affiché : ${ctx.move}\n- Profondeur d'analyse : ${ctx.depth}\n`;
      if (!ctx.url && ctx.pgn) {
        const pgn = ctx.pgn.length > MAX_PGN ? `${ctx.pgn.slice(0, MAX_PGN)}\n…` : ctx.pgn;
        body += `\n<details><summary>PGN</summary>\n\n\`\`\`\n${pgn}\n\`\`\`\n</details>\n`;
      }
    }
    body += `\n---\n_Envoyé depuis le site · ${navigator.userAgent}_\n`;

    const params = new URLSearchParams({ title: type.prefix + title, body, labels: type.label });
    window.open(`${REPO}/issues/new?${params}`, '_blank', 'noopener');
    dialog.close();
    form.reset();
  });
}
