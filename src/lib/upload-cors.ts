/** Raw upload routes bypass Next's body-cloning proxy; keep their CORS here. */
export function uploadCors(req: Request, response: Response) {
  const origin = req.headers.get('origin')
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.append('Vary', 'Origin')
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Clip-Meta,X-Evidence-Title,X-Photo-Title,X-Upload-Size,X-Discord-Id')
    response.headers.set('Access-Control-Max-Age', '600')
  }
  return response
}
export function uploadOptions(req: Request) { return uploadCors(req, new Response(null, { status: 204 })) }
