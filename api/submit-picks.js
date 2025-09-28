// Vercel serverless function for handling form submissions
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const formData = req.body;
    
    // Log the submission (you can see this in Vercel dashboard)
    console.log('New picks submission:', {
      user: formData.user,
      timestamp: new Date().toISOString(),
      picks: {
        game1: formData.game1,
        game2: formData.game2,
        game3: formData.game3,
        // ... add all games
      }
    });

    // You can also save to a database here
    // Example: await saveToDatabase(formData);
    
    // Or send yourself an email
    // Example: await sendEmail(formData);

    res.status(200).json({ 
      success: true, 
      message: 'Picks submitted successfully!' 
    });
  } catch (error) {
    console.error('Error processing submission:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error processing submission' 
    });
  }
}


