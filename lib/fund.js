'use strict'

const Arborist = require('@npmcli/arborist')
const archy = require('archy')

const npm = require('./npm.js')
const fetchPackageMetadata = require('./fetch-package-metadata.js')
const output = require('./utils/output.js')
const openUrl = require('./utils/open-url.js')
const {
  flatCacheSymbol,
  getFundingInfo,
  retrieveFunding,
  validFundingField
} = require('./utils/funding.js')
const usageUtil = require('./utils/usage.js')

const usage = usageUtil(
  'fund',
  'npm fund',
  'npm fund [--json] [--browser] [--unicode] [[<@scope>/]<pkg> [--which=<fundingSourceNumber>]'
)

const completion = (opts, cb) => {
  const argv = opts.conf.argv.remain
  switch (argv[2]) {
    case 'fund':
      return cb(null, [])
    default:
      return cb(new Error(argv[2] + ' not recognized'))
  }
}

const cmd = (args, cb) => fund(args).then(() => cb()).catch(cb)

function printJSON (fundingInfo) {
  return JSON.stringify(fundingInfo, null, 2)
}

// the human-printable version does some special things that turned out to
// be very verbose but hopefully not hard to follow: we stack up items
// that have a shared url/type and make sure they're printed at the highest
// level possible, in that process they also carry their dependencies along
// with them, moving those up in the visual tree
function printHuman (fundingInfo, opts) {
  const flatCache = fundingInfo[flatCacheSymbol]

  const { name, version } = fundingInfo
  const printableVersion = version ? `@${version}` : ''

  const items = Object.keys(flatCache).map((url) => {
    const deps = flatCache[url]

    const packages = deps.map((dep) => {
      const { name, version } = dep

      const printableVersion = version ? `@${version}` : ''
      return `${name}${printableVersion}`
    })

    return {
      label: url,
      nodes: [packages.join(', ')]
    }
  })

  return archy({ label: `${name}${printableVersion}`, nodes: items }, '', { unicode: opts.unicode })
}

async function openFundingUrl (packageName, fundingSourceNumber) {
  function getUrlAndOpen (packageMetadata) {
    const { funding } = packageMetadata
    const validSources = [].concat(retrieveFunding(funding)).filter(validFundingField)

    if (validSources.length === 1 || (fundingSourceNumber > 0 && fundingSourceNumber <= validSources.length)) {
      const { type, url } = validSources[fundingSourceNumber ? fundingSourceNumber - 1 : 0]
      const typePrefix = type ? `${type} funding` : 'Funding'
      const msg = `${typePrefix} available at the following URL`
      return new Promise((resolve, reject) =>
        openUrl(url, msg, err => err
          ? reject(err)
          : resolve()
        ))
    } else if (!(fundingSourceNumber >= 1)) {
      validSources.forEach(({ type, url }, i) => {
        const typePrefix = type ? `${type} funding` : 'Funding'
        const msg = `${typePrefix} available at the following URL`
        console.log(`${i + 1}: ${msg}: ${url}`)
      })
      console.log('Run `npm fund [<@scope>/]<pkg> --which=1`, for example, to open the first funding URL listed in that package')
    } else {
      const noFundingError = new Error(`No valid funding method available for: ${packageName}`)
      noFundingError.code = 'ENOFUND'

      throw noFundingError
    }
  }

  fetchPackageMetadata(
    packageName,
    '.',
    { fullMetadata: true },
    function (err, packageMetadata) {
      if (err) { throw err }
      getUrlAndOpen(packageMetadata)
    }
  )
}

const fund = async (args) => {
  const opts = npm.flatOptions
  const packageName = args[0]
  const numberArg = opts.which

  const fundingSourceNumber = numberArg && parseInt(numberArg, 10)

  if (numberArg !== undefined && (String(fundingSourceNumber) !== numberArg || fundingSourceNumber < 1)) {
    const err = new Error('`npm fund [<@scope>/]<pkg> [--which=fundingSourceNumber]` must be given a positive integer')
    err.code = 'EFUNDNUMBER'
    throw err
  }

  if (opts.global) {
    const err = new Error('`npm fund` does not support global packages')
    err.code = 'EFUNDGLOBAL'
    throw err
  }

  if (packageName) {
    await openFundingUrl(packageName, fundingSourceNumber)
    return
  }

  const where = npm.prefix
  const arb = new Arborist({ ...opts, path: where })
  const tree = await arb.loadActual()
  /*
    console.log(Array.from(tree.edgesOut.values())
        .filter(i => i.to)
        .map(i => ({
            name: i.to.package.name,
            version: i.to.package.version,
            funding: i.to.package.funding
        })))
  */
  const fundingInfo = getFundingInfo(tree)

  const print = opts.json
    ? printJSON
    : printHuman

  output(
    print(
      fundingInfo,
      opts
    )
  )
}

module.exports = Object.assign(cmd, { usage, completion })
