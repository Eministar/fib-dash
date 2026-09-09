/** Die Chunk-Route umgeht Nexts Body-klonenden Proxy; ihr CORS steht deshalb hier. */
export function uploadCors(req: Request, response: Response) {
  const origin = req.headers.get('origin')
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.append('Vary', 'Origin')
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Chunk-Sha256,X-Discord-Id')
    response.headers.set('Access-Control-Max-Age', '600')
  }
  return response
}
export function uploadOptions(req: Request) { return uploadCors(req, new Response(null, { status: 204 })) }
