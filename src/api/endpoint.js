// pages/api/my-endpoint.js

export default function handler(req, res) {
    // Set CORS headers for every response:
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  
    // If this is a preflight OPTIONS request, return 204 (No Content) immediately.
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    
    // Now handle the actual request.
    if (req.method === 'GET') {
      // Your GET logic here, for example:
      return res.status(200).json({ message: 'GET request successful' });
    } else if (req.method === 'POST') {
      // Your POST logic here, for example:
      const data = req.body;
      return res.status(200).json({ message: 'POST request successful', data });
    } else {
      // For unsupported methods, send a 405 Method Not Allowed
      return res.status(405).json({ message: 'Method Not Allowed' });
    }
  }
  