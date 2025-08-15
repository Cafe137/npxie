#!/usr/bin/env node

import { main } from './npxie'

main(process.argv).catch(error => {
    console.error(error)
    process.exit(1)
})
