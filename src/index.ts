#!/usr/bin/env node

import axios from 'axios'
import { Dates, Objects, System, Types } from 'cafe-utility'

main()

async function main() {
    switch (process.argv[2]) {
        case 'await':
            const url = Types.asUrl(process.argv[3])
            await runAwait(url)
            break
        case 'json-equals':
            const jsonUrl = Types.asUrl(process.argv[3])
            const objectPath = Types.asString(process.argv[4])
            const expected = Types.asString(process.argv[5])
            await runJsonEquals(jsonUrl, objectPath, expected)
            break
        case 'code-equals':
            const codeUrl = Types.asUrl(process.argv[3])
            const code = Types.asNumber(process.argv[4])
            await runCodeEquals(codeUrl, code)
            break
        case '3xx':
            const redirectUrl = Types.asUrl(process.argv[3])
            const location = Types.asString(process.argv[4])
            await run3xx(redirectUrl, location)
            break
        default:
            throw Error('Invalid command')
    }
}

async function runAwait(url: string) {
    await System.waitFor(
        async () => {
            await axios.get(url, { timeout: 1000 })
            return true
        },
        Dates.seconds(1),
        5
    )
    console.log('Success')
}

async function runJsonEquals(url: string, objectPath: string, expected: string) {
    const response = await axios.get(url, { timeout: 1000 })
    const actual = String(Objects.getDeep(response.data, objectPath))
    if (actual !== expected) {
        throw Error(`Expected ${objectPath} to be ${expected} but got ${actual}`)
    }
    console.log('Success')
}

async function runCodeEquals(url: string, code: number) {
    const response = await axios.get(url, { timeout: 1000, validateStatus: () => true, maxRedirects: 0 })
    if (response.status !== code) {
        throw Error(`Expected ${url} to return ${code} but got ${response.status}`)
    }
    console.log('Success')
}

async function run3xx(url: string, location: string) {
    const response = await axios.get(url, { timeout: 1000, validateStatus: () => true, maxRedirects: 0 })
    const statusCode = response.status
    const locationHeader = response.headers.location
    if (statusCode < 300 || statusCode >= 400) {
        throw Error(`Expected status code to be 3xx but got ${statusCode}`)
    }
    if (locationHeader !== location) {
        throw Error(`Expected location header to be ${location} but got ${locationHeader}`)
    }
    console.log('Success')
}
