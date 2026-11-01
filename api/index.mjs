// Vercel serverless entry. vercel.json rewrites every non-static path here; env vars come from the Vercel dashboard.
import { createApp } from '../lib/app.mjs'

const { handler } = createApp(process.cwd()) // created once per warm instance, reused across requests
export default handler
