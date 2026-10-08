/**
 * AniDost API Worker
 * KV Namespace binding: KV_BINDING
 * Admin password: ADMIN_PASSWORD (env variable)
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const adminPassword = env.ADMIN_PASSWORD || 'default_admin_pass_123';

    function checkAuth(req) {
      const pw = req.headers.get('X-Admin-Password') || url.searchParams.get('pw');
      return pw === adminPassword;
    }

    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    try {
      // GET /anime_link.js
      if (path === '/anime_link.js' && request.method === 'GET') {
        const linksJson = await env.KV_BINDING.get('anime_link_index') || '[]';
        const links = JSON.parse(linksJson);

        const jsContent =
          `window.ANIME_LINKS = ${JSON.stringify(links, null, 2)};\n` +
          `window.dispatchEvent(new Event("anime-links-ready"));\n`;

        return new Response(jsContent, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=60',
          },
        });
      }

      // GET /anime/{slug}.js
      if (path.startsWith('/anime/') && path.endsWith('.js') && request.method === 'GET') {
        const slug = path.replace('/anime/', '').replace('.js', '');
        const dataJson = await env.KV_BINDING.get(`anime:${slug}`);

        if (!dataJson) {
          return new Response('window.ANIME_REGISTRY = window.ANIME_REGISTRY || {};', {
            status: 404,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/javascript; charset=utf-8',
            },
          });
        }

        const jsContent =
          `window.ANIME_REGISTRY = window.ANIME_REGISTRY || {};\n` +
          `window.ANIME_REGISTRY[${JSON.stringify(slug)}] = ${dataJson};\n`;

        return new Response(jsContent, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        });
      }

      // POST /api/save
      if (path === '/api/save' && request.method === 'POST') {
        if (!checkAuth(request)) return jsonResponse({ error: 'Unauthorized' }, 401);

        const data = await request.json();
        if (!data.title) return jsonResponse({ error: 'Title required' }, 400);

        const slug = data.slug || data.title.toLowerCase()
          .trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

        data.slug = slug;
        data.updated_at_ms = Date.now();
        if (!data.created_at_ms) data.created_at_ms = Date.now();

        await env.KV_BINDING.put(`anime:${slug}`, JSON.stringify(data));
        await rebuildIndex(env, url.origin);

        return jsonResponse({ success: true, slug });
      }

      // POST /api/delete
      if (path === '/api/delete' && request.method === 'POST') {
        if (!checkAuth(request)) return jsonResponse({ error: 'Unauthorized' }, 401);

        const { slug } = await request.json();
        if (!slug) return jsonResponse({ error: 'Slug required' }, 400);

        await env.KV_BINDING.delete(`anime:${slug}`);
        await rebuildIndex(env, url.origin);

        return jsonResponse({ success: true });
      }

      // GET /api/list
      if (path === '/api/list' && request.method === 'GET') {
        if (!checkAuth(request)) return jsonResponse({ error: 'Unauthorized' }, 401);

        const list = await env.KV_BINDING.list({ prefix: 'anime:' });
        const slugs = list.keys.map(k => k.name.replace('anime:', ''));
        return jsonResponse({ slugs });
      }

      // GET /api/get/{slug}
      if (path.startsWith('/api/get/') && request.method === 'GET') {
        if (!checkAuth(request)) return jsonResponse({ error: 'Unauthorized' }, 401);

        const slug = path.replace('/api/get/', '');
        const dataJson = await env.KV_BINDING.get(`anime:${slug}`);

        if (!dataJson) return jsonResponse({ error: 'Not found' }, 404);
        return jsonResponse(JSON.parse(dataJson));
      }

      // GET /
      if (path === '/') {
        return jsonResponse({
          status: 'ok',
          service: 'AniDost API',
          endpoints: [
            'GET  /anime_link.js',
            'GET  /anime/{slug}.js',
            'GET  /api/list  (auth)',
            'GET  /api/get/{slug}  (auth)',
            'POST /api/save  (auth)',
            'POST /api/delete  (auth)',
          ],
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

async function rebuildIndex(env, baseUrl) {
  const list = await env.KV_BINDING.list({ prefix: 'anime:' });
  const slugs = list.keys.map(k => k.name.replace('anime:', ''));
  const links = slugs.map(s => `${baseUrl}/anime/${s}.js`);
  await env.KV_BINDING.put('anime_link_index', JSON.stringify(links));
        }
