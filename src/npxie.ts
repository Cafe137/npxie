import axios from 'axios'
import { Dates, Objects, Optional, Random, Strings, System, Types } from 'cafe-utility'
import { execSync } from 'child_process'
import { readFile } from 'fs/promises'

export async function main(argv: string[]) {
    switch (argv[2]) {
        case 'await':
            const url = Types.asUrl(argv[3])
            await runAwait(url)
            break
        case 'json-equals':
            const jsonUrl = Types.asUrl(argv[3])
            const objectPath = Types.asString(argv[4])
            const expected = Types.asString(argv[5])
            await runJsonEquals(jsonUrl, objectPath, expected)
            break
        case 'code-equals':
            const codeUrl = Types.asUrl(argv[3])
            const code = Types.asNumber(argv[4])
            await runCodeEquals(codeUrl, code)
            break
        case 'content-type-is':
            const mimeUrl = Types.asUrl(argv[3])
            const mimeType = Types.asString(argv[4])
            await runContentTypeIs(mimeUrl, mimeType)
            break
        case '3xx':
            const redirectUrl = Types.asUrl(argv[3])
            const location = Types.asString(argv[4])
            await run3xx(redirectUrl, location)
            break
        case 'post-json':
            const postUrl = Types.asUrl(argv[3])
            const size = Types.asNumber(argv[4])
            await postJsonData(postUrl, size)
            break
        case 'eval-and-expect':
            const command = Types.asString(argv[3])
            const expectedSubstringParameter = Types.asString(argv[4])
            const expectedSubstrings = argv[5]
                ? expectedSubstringParameter.split(Types.asString(argv[5]))
                : [expectedSubstringParameter]
            await runEvalAndExpect(command, expectedSubstrings)
            break
        case 'coverage-comparison':
            const repository = Types.asString(argv[3])
            const baseBranch = Types.asString(argv[4])
            const currentBranch = Types.asString(argv[5])
            const path = Types.asString(argv[6])
            const issueNumber = Types.asNumber(argv[7])
            const authorization = Types.asString(argv[8])
            await runCoverageComparison(repository, baseBranch, currentBranch, path, issueNumber, authorization)
            break
        default:
            throw Error('Invalid command')
    }
}

async function postJsonData(url: string, size: number) {
    const buffer = Buffer.alloc(size)
    for (let i = 0; i < size; i++) {
        buffer[i] = Random.intBetween(0, 255)
    }
    const data = `{"value":"${buffer.toString('hex')}"}`
    const response = await axios.post(url, { data, timeout: 60_000 })
    console.log(`Posted ${data.length} bytes to ${url}, response status: ${response.status}`)
}

async function runAwait(url: string) {
    await System.waitFor(
        async () => {
            await axios.get(url, { timeout: 1000 })
            return true
        },
        { attempts: 5, waitMillis: Dates.seconds(1) }
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

async function runContentTypeIs(url: string, mimeType: string) {
    const response = await axios.get(url, { timeout: 1000, validateStatus: () => true, maxRedirects: 0 })
    const contentType = response.headers['content-type']
    if (contentType !== mimeType) {
        throw Error(`Expected content type to be ${mimeType} but got ${contentType}`)
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

async function runEvalAndExpect(command: string, expectedSubstrings: string[]) {
    const output = execSync(command, { encoding: 'utf8', timeout: Dates.seconds(60) })
    for (const expectedSubstring of expectedSubstrings) {
        if (!output.includes(expectedSubstring)) {
            throw Error(`Expected output to contain "${expectedSubstring}" but got "${output}"`)
        }
    }
    console.log('Success')
}

async function runCoverageComparison(
    repository: string,
    baseBranch: string,
    currentBranch: string,
    path: string,
    issueNumber: number,
    authorization: string
) {
    const coverageOld = await githubRead(repository, baseBranch, path, authorization)
    const coverageNew = await readFile(path, 'utf8')
    const comparison = compareCoverages(
        coverageOld.getOrFallback(() => emptyCoverageFile()).asJson(),
        JSON.parse(coverageNew)
    )
    await deleteMarkedGithubComments(repository, issueNumber, '<!-- coverage-report -->', authorization)
    const table = convertCoverageComparisonToMarkdownTable(comparison)
    await githubComment(repository, issueNumber, '<!-- coverage-report -->\n' + table, authorization)
    const existingCoverage = await githubRead(repository, currentBranch, path, authorization)
    await githubCommit(
        repository,
        currentBranch,
        path,
        coverageNew,
        'test: update test coverage [skip ci]',
        authorization,
        existingCoverage.value ? existingCoverage.value.sha : undefined
    )
}

function compareCoverages(coverageOld: CoverageSummary, coverageNew: CoverageSummary): CoverageComparison {
    const diff: CoverageComparison = {}
    for (const file in coverageNew) {
        const key = file === 'total' ? 'Total' : Strings.after(file, '/src/')
        if (!key) {
            throw Error(`Invalid file name: ${file}`)
        }
        diff[key] = {
            coveredNow: coverageNew[file].lines.covered,
            totalNow: coverageNew[file].lines.total,
            coveredBefore: 0,
            totalBefore: 0
        }
        if (coverageOld[file]) {
            diff[key].coveredBefore = coverageOld[file].lines.covered
            diff[key].totalBefore = coverageOld[file].lines.total
        }
    }
    return diff
}

function convertCoverageComparisonToMarkdownTable(comparison: CoverageComparison): string {
    let table = '| File | Coverage Now | Coverage Before | Delta% | Rating |\n'
    table += '|---|---|---|---|---|\n'
    for (const file in comparison) {
        const data = comparison[file]
        const pctBefore = (data.coveredBefore / data.totalBefore) * 100 || 0
        const pctNow = (data.coveredNow / data.totalNow) * 100 || 0
        const delta = (pctNow - pctBefore).toFixed(2)
        const rating = pctNow < pctBefore ? '🔴' : pctNow > pctBefore ? '🟢' : ''
        table += `| ${file} | ${data.coveredNow} / ${data.totalNow} | ${data.coveredBefore} / ${data.totalBefore} | ${delta} | ${rating} |\n`
    }
    return table
}

interface GithubFile {
    sha: string
    content: string
    asJson(): ReturnType<typeof JSON.parse>
}

function emptyCoverageFile(): GithubFile {
    return { sha: '', content: '{}', asJson: () => JSON.parse('{}') }
}

async function githubRead(
    repository: string,
    branch: string,
    path: string,
    authorization: string
): Promise<Optional<GithubFile>> {
    const result = await axios.get(`https://api.github.com/repos/${repository}/contents/${path}`, {
        params: { ref: branch },
        headers: { Authorization: `Bearer ${authorization}` },
        timeout: Dates.seconds(10),
        validateStatus: status => status === 200 || status === 404
    })
    if (result.status === 404) {
        return Optional.empty()
    }
    const content = Buffer.from(result.data.content, 'base64').toString('utf8')
    return Optional.of({ sha: result.data.sha, content, asJson: () => JSON.parse(content) })
}

async function githubComment(repository: string, issueNumber: number, body: string, authorization: string) {
    const result = await axios.post(
        `https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`,
        { body },
        { headers: { Authorization: `Bearer ${authorization}` }, timeout: Dates.seconds(10) }
    )
    return result.data
}

async function deleteMarkedGithubComments(
    repository: string,
    issueNumber: number,
    marker: string,
    authorization: string
): Promise<void> {
    const comments = await axios.get(`https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`, {
        headers: { Authorization: `Bearer ${authorization}` },
        timeout: Dates.seconds(10)
    })
    for (const comment of comments.data) {
        if (comment.body.includes(marker)) {
            await axios.delete(`https://api.github.com/repos/${repository}/issues/comments/${comment.id}`, {
                headers: { Authorization: `Bearer ${authorization}` },
                timeout: Dates.seconds(10)
            })
        }
    }
}

async function githubCommit(
    repository: string,
    branch: string,
    path: string,
    content: string,
    message: string,
    authorization: string,
    sha?: string
) {
    await axios.put(
        `https://api.github.com/repos/${repository}/contents/${path}`,
        { message, content: Buffer.from(content).toString('base64'), branch, sha },
        { headers: { Authorization: `Bearer ${authorization}` }, timeout: Dates.seconds(10) }
    )
}

interface CoverageComparison {
    [file: string]: {
        coveredNow: number
        totalNow: number
        coveredBefore: number
        totalBefore: number
    }
}

interface Coverage {
    total: number
    covered: number
    skipped: number
    pct: number
}

interface CoverageSummary {
    [file: string]: {
        lines: Coverage
        statements: Coverage
        functions: Coverage
        branches: Coverage
    }
}
