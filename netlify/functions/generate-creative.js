/**
 * PDFoster Creative Generation API
 * 
 * Unified endpoint for AI image and video generation.
 * Called by Claude/Cowork to generate creative assets.
 * 
 * Endpoints:
 *   POST /generate-creative
 *   Body: { type: "image" | "video", prompt: string, customer_id?: string, options?: object }
 * 
 * Environment Variables Required:
 *   OPENAI_API_KEY - For DALL-E image generation
 *   RUNWAY_API_KEY - For video generation
 *   SUPABASE_URL - For usage logging
 *   SUPABASE_SERVICE_ROLE_KEY - For usage logging
 *   PDFOSTER_API_SECRET - Optional: secure API access
 */

const fetch = require('node-fetch');

// Cost per generation (for tracking)
const COSTS = {
  'dall-e-3-standard': 0.04,
  'dall-e-3-hd': 0.08,
  'dall-e-3-wide': 0.08,
  'dall-e-3-wide-hd': 0.12,
  'gpt-image-mini': 0.015,
  'runway-video': 0.50  // Approximate per 5-sec video
};

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { type, prompt, customer_id, options = {} } = body;

    if (!type || !prompt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: type, prompt' })
      };
    }

    let result;
    let cost = 0;
    let costKey = '';

    switch (type) {
      case 'image':
        result = await generateImage(prompt, options);
        costKey = options.quality === 'hd' 
          ? (options.size?.includes('1792') ? 'dall-e-3-wide-hd' : 'dall-e-3-hd')
          : (options.size?.includes('1792') ? 'dall-e-3-wide' : 'dall-e-3-standard');
        cost = COSTS[costKey];
        break;

      case 'video':
        result = await generateVideo(prompt, options);
        costKey = 'runway-video';
        cost = COSTS[costKey];
        break;

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Unknown type: ${type}. Use "image" or "video"` })
        };
    }

    // Log usage if customer_id provided
    if (customer_id && process.env.SUPABASE_URL) {
      await logUsage(customer_id, type, cost, costKey);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        type,
        cost,
        ...result
      })
    };

  } catch (error) {
    console.error('Generation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message || 'Generation failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};

/**
 * Generate image via OpenAI DALL-E
 */
async function generateImage(prompt, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const {
    model = 'dall-e-3',
    size = '1024x1024',
    quality = 'standard',
    style = 'vivid'
  } = options;

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
      quality,
      style,
      response_format: 'url'
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message);
  }

  return {
    image_url: data.data[0].url,
    revised_prompt: data.data[0].revised_prompt,
    model,
    size,
    quality
  };
}

/**
 * Generate video via Runway API
 */
async function generateVideo(prompt, options = {}) {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) {
    throw new Error('RUNWAY_API_KEY not configured');
  }

  const {
    duration = 5,
    model = 'gen3a_turbo'
  } = options;

  const response = await fetch('https://api.dev.runwayml.com/v1/text_to_video', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06'
    },
    body: JSON.stringify({
      model,
      prompt_text: prompt,
      duration,
      watermark: false,
      ratio: '16:9'
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return {
    task_id: data.id,
    status: 'processing',
    poll_url: `https://api.dev.runwayml.com/v1/tasks/${data.id}`,
    model,
    duration,
    note: 'Video is generating. Poll the task_id endpoint for completion.'
  };
}

/**
 * Log usage to Supabase for billing/tracking
 */
async function logUsage(customerId, type, cost, costKey) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('Supabase not configured, skipping usage log');
      return;
    }

    await fetch(`${supabaseUrl}/rest/v1/creative_usage`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        customer_id: customerId,
        type,
        cost,
        cost_key: costKey,
        created_at: new Date().toISOString()
      })
    });
  } catch (error) {
    console.error('Failed to log usage:', error);
  }
}
