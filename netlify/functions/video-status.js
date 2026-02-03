/**
 * PDFoster Video Status Checker
 * 
 * Polls Runway API to check video generation status.
 * 
 * Endpoint:
 *   GET /video-status?task_id=xxx
 *   
 * Returns:
 *   { status: "processing" | "completed" | "failed", video_url?: string }
 */

const fetch = require('node-fetch');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const taskId = event.queryStringParameters?.task_id;

  if (!taskId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing task_id parameter' })
    };
  }

  try {
    const apiKey = process.env.RUNWAY_API_KEY;
    if (!apiKey) {
      throw new Error('RUNWAY_API_KEY not configured');
    }

    const response = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06'
      }
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Map Runway status to our simplified status
    let status = 'processing';
    let videoUrl = null;

    if (data.status === 'SUCCEEDED') {
      status = 'completed';
      videoUrl = data.output?.[0];  // Runway returns array of outputs
    } else if (data.status === 'FAILED') {
      status = 'failed';
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        task_id: taskId,
        status,
        video_url: videoUrl,
        progress: data.progress,
        raw_status: data.status
      })
    };

  } catch (error) {
    console.error('Status check error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
