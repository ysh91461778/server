export const CT = { 'Content-Type': 'application/json' };

export const getJSON = (url) =>
  fetch(url, { credentials: 'same-origin' }).then(r => r.json());

export const postJSON = (url, data) =>
  fetch(url, { method: 'POST', headers: CT, body: JSON.stringify(data) });

export const patchField = (id, field, value) =>
  postJSON('/api/update', { id, field, value });
