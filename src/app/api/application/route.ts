import { NextResponse } from 'next/server'
import { createApplication } from '@/server/application-service'

export async function POST() {
  return NextResponse.json(createApplication())
}
