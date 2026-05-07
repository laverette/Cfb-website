exports.handler = async function () {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Hello from Netlify Functions"
      })
    };
  };