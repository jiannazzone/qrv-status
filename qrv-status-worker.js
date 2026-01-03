const STATUS_OPTIONS = [
  { value: 'operational', label: 'Operational', defaultDetail: 'All systems operating normally.' },
  { value: 'recovering', label: 'Recovering', defaultDetail: 'Systems are recovering from a previous issue.' },
  { value: 'degraded_performance', label: 'Degraded Performance', defaultDetail: 'Experiencing degraded performance.' },
  { value: 'outage', label: 'Outage', defaultDetail: 'System outage in progress.' },
  { value: 'under_maintenance', label: 'Under Maintenance', defaultDetail: 'Scheduled maintenance in progress.' },
];

const MESSAGE_TYPES = [
  { value: 'info', label: 'Info' },
  { value: 'tip', label: 'Tip' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'update', label: 'App Update' },
];

const SEVERITY = ['operational', 'recovering', 'degraded_performance', 'under_maintenance', 'outage'];

const DEFAULT_STATUS = {
  status_code: 'operational',
  status_message: 'All systems operating normally.',
  last_updated: new Date().toISOString(),
  components: [
    { name: 'Live Spots', status: 'operational', detail: 'All systems operating normally.' }
  ],
  developer_message: null
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/status.json') {
      return handleStatusGet(env);
    }
    
    if (url.pathname === '/admin') {
      if (request.method === 'GET') {
        return handleAdminGet(request, env);
      }
      if (request.method === 'POST') {
        return handleAdminPost(request, env);
      }
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

async function handleStatusGet(env) {
  const status = await env.STATUS_KV.get('current', 'json') || DEFAULT_STATUS;
  
  return new Response(JSON.stringify(status, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

function checkAuth(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Basic ')) return false;
  
  const encoded = auth.slice(6);
  const decoded = atob(encoded);
  const [user, pass] = decoded.split(':');
  
  return user === 'admin' && pass === env.ADMIN_PASSWORD;
}

function unauthorizedResponse() {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="QRV Status Admin"' }
  });
}

async function handleAdminGet(request, env) {
  if (!checkAuth(request, env)) return unauthorizedResponse();
  
  const status = await env.STATUS_KV.get('current', 'json') || DEFAULT_STATUS;
  return new Response(renderAdminPage(status), {
    headers: { 'Content-Type': 'text/html' }
  });
}

async function handleAdminPost(request, env) {
  if (!checkAuth(request, env)) return unauthorizedResponse();

  const formData = await request.formData();
  const action = formData.get('action') || 'update_status';

  const current = await env.STATUS_KV.get('current', 'json') || DEFAULT_STATUS;
  let message = null;

  if (action === 'post_message') {
    const messageText = formData.get('message_text')?.trim();
    const messageType = formData.get('message_type') || 'info';

    if (messageText) {
      current.developer_message = {
        text: messageText,
        type: messageType,
        date: new Date().toISOString()
      };
      message = 'Developer message posted';
    } else {
      message = 'Message text is required';
    }
  } else if (action === 'clear_message') {
    current.developer_message = null;
    message = 'Developer message cleared';
  } else {
    // Default: update_status action
    const component = formData.get('component');
    const newStatus = formData.get('status');
    const detail = formData.get('detail')?.trim();

    // Update the component
    const compIndex = current.components.findIndex(c => c.name === component);
    if (compIndex >= 0) {
      current.components[compIndex].status = newStatus;
      current.components[compIndex].detail = detail || STATUS_OPTIONS.find(s => s.value === newStatus)?.defaultDetail;
    } else {
      current.components.push({
        name: component,
        status: newStatus,
        detail: detail || STATUS_OPTIONS.find(s => s.value === newStatus)?.defaultDetail
      });
    }

    // Derive top-level status (worst wins)
    const worstStatus = current.components.reduce((worst, comp) => {
      return SEVERITY.indexOf(comp.status) > SEVERITY.indexOf(worst) ? comp.status : worst;
    }, 'operational');

    current.status_code = worstStatus;
    current.status_message = STATUS_OPTIONS.find(s => s.value === worstStatus)?.defaultDetail;
    current.last_updated = new Date().toISOString();

    message = `Updated ${component} to ${newStatus}`;
  }

  await env.STATUS_KV.put('current', JSON.stringify(current));

  return new Response(renderAdminPage(current, message), {
    headers: { 'Content-Type': 'text/html' }
  });
}

function renderAdminPage(status, message = null) {
  const components = status.components || [];
  const componentOptions = [...new Set(components.map(c => c.name).concat(['Live Spots']))];
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QRV Status Admin</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 500px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .current-status { font-size: 0.9rem; }
    .current-status h2 { font-size: 1rem; margin: 0 0 8px 0; }
    .component { padding: 8px 0; border-bottom: 1px solid #eee; }
    .component:last-child { border-bottom: none; }
    .component-name { font-weight: 500; }
    .component-status { 
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
      margin-left: 8px;
    }
    .status-operational { background: #d4edda; color: #155724; }
    .status-recovering { background: #cce5ff; color: #004085; }
    .status-degraded_performance { background: #fff3cd; color: #856404; }
    .status-under_maintenance { background: #e2e3e5; color: #383d41; }
    .status-outage { background: #f8d7da; color: #721c24; }
    label { display: block; margin-bottom: 4px; font-weight: 500; }
    select, input, textarea {
      width: 100%;
      padding: 10px;
      margin-bottom: 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 1rem;
    }
    button {
      width: 100%;
      padding: 12px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover { background: #0056b3; }
    .message {
      padding: 12px;
      background: #d4edda;
      color: #155724;
      border-radius: 6px;
      margin-bottom: 16px;
    }
    .updated { font-size: 0.8rem; color: #666; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>QRV Status Admin</h1>
  
  ${message ? `<div class="message">${message}</div>` : ''}
  
  <div class="card current-status">
    <h2>Current Status</h2>
    ${components.map(c => `
      <div class="component">
        <span class="component-name">${c.name}</span>
        <span class="component-status status-${c.status}">${c.status.replace('_', ' ')}</span>
        <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">${c.detail}</div>
      </div>
    `).join('')}
    <div class="updated">Last updated: ${new Date(status.last_updated).toLocaleString()}</div>
  </div>
  
  <div class="card">
    <h2 style="font-size: 1rem; margin: 0 0 12px 0;">Update Component Status</h2>
    <form method="POST">
      <input type="hidden" name="action" value="update_status">
      <label for="component">Component</label>
      <select name="component" id="component">
        ${componentOptions.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>

      <label for="status">Status</label>
      <select name="status" id="status">
        ${STATUS_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
      </select>

      <label for="detail">Detail (optional)</label>
      <textarea name="detail" id="detail" rows="2" placeholder="Leave blank for default message"></textarea>

      <button type="submit">Update Status</button>
    </form>
  </div>

  <div class="card">
    <h2 style="font-size: 1rem; margin: 0 0 12px 0;">Developer Message</h2>
    ${status.developer_message ? `
      <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
        <div style="font-size: 0.8rem; color: #666; margin-bottom: 4px;">
          ${MESSAGE_TYPES.find(t => t.value === status.developer_message.type)?.label || 'Info'} - ${new Date(status.developer_message.date).toLocaleDateString()}
        </div>
        <div>${status.developer_message.text}</div>
      </div>
      <form method="POST">
        <input type="hidden" name="action" value="clear_message">
        <button type="submit" style="background: #dc3545;">Clear Message</button>
      </form>
    ` : `
      <form method="POST">
        <input type="hidden" name="action" value="post_message">
        <label for="message_type">Type</label>
        <select name="message_type" id="message_type">
          ${MESSAGE_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>

        <label for="message_text">Message</label>
        <textarea name="message_text" id="message_text" rows="3" placeholder="Enter your message..."></textarea>

        <button type="submit" style="background: #28a745;">Post Message</button>
      </form>
    `}
  </div>

  <script>
    const defaults = ${JSON.stringify(Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s.defaultDetail])))};
    document.getElementById('status').addEventListener('change', function() {
      document.getElementById('detail').placeholder = defaults[this.value] || '';
    });
  </script>
</body>
</html>`;
}
