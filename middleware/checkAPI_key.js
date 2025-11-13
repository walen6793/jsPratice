const mySecretKey = process.env.MY_SECRET_KEY

function checkAPI_key(req,res,next){
    const api_key = req.headers['X-API-KEY'] || req.headers['x-api-key']
    if (api_key && api_key === mySecretKey){
        next()
    }else {
        res.status(403).json({message: 'Forbidden. Invalid API Key'})
        return
    }
}
module.exports = checkAPI_key

