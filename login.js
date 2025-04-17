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
        let payload;
        try {
            const parts = token.split('.');
            payload = JSON.parse(atob(parts[1]));
            localStorage.setItem('userId', payload.sub);
        } catch (err) {
            console.error('Error parsing JWT token:', err);
        }
        
        // After successful authentication in login.js
        if (token) {
            localStorage.setItem('jwtToken', token);
            localStorage.setItem('userId', payload.sub);
            
            // Try to get user data immediately
            const userQuery = `{
                user {
                    id
                    login
                    firstName
                    lastName
                }
            }`;
            
            try {
                const response = await fetch('https://learn.reboot01.com/api/graphql-engine/v1/graphql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ query: userQuery })
                });
                
                const userData = await response.json();
                if (userData?.data?.user?.[0]) {
                    localStorage.setItem('user', JSON.stringify(userData.data.user[0]));
                }
            } catch (error) {
                console.warn('Error pre-fetching user data:', error);
            }
            
            window.location.href = 'profile.html';
        }
    } catch (error) {
        errorMessage.textContent = error.message;
        console.error('Login error:', error);
    }
});