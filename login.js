document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const usernameOrEmail = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');
    
    // Clear previous error messages
    errorMessage.textContent = '';
    
    // Basic validation
    if (!usernameOrEmail || !password) {
        errorMessage.textContent = 'Please enter both username/email and password';
        return;
    }
    
    // Create Basic Auth token
    const authToken = btoa(`${usernameOrEmail}:${password}`);
    
    try {
        const response = await fetch('https://learn.reboot01.com/api/auth/signin', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authToken}`
            }
        });
        
        console.log('Response received:', response);
        
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Invalid username/email or password');
            } else {
                throw new Error(`Login failed: ${response.statusText}`);
            }
        }
        
        // Get the response data
        const data = await response.json().catch(() => response.text());
        
        // Handle token - could be direct string or object with token property
        let token;
        if (typeof data === 'string') {
            // API returned the token directly as a string
            token = data;
        } else if (data && data.token) {
            // API returned an object with token property
            token = data.token;
        } else {
            throw new Error('Invalid response format from server');
        }
        
        // Store token
        localStorage.setItem('jwtToken', token);
        
        // Extract user ID from JWT
        try {
            const parts = token.split('.');
            const payload = JSON.parse(atob(parts[1]));
            localStorage.setItem('userId', payload.sub);
        } catch (err) {
            console.error('Error parsing JWT token:', err);
        }
        
        window.location.href = 'profile.html';
    } catch (error) {
        errorMessage.textContent = error.message;
        console.error('Login error:', error);
    }
});