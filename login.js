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
        
        const data = await response.json();
        
        // Store token and redirect
        localStorage.setItem('jwtToken', data.token);
        
        // Optional: Save user ID from JWT for easier access
        if (data && data.token) {  // Add this check
            const parts = data.token.split('.');
            const payload = JSON.parse(atob(parts[1]));
            localStorage.setItem('userId', payload.sub);
        } else {
            console.error('Token not found in response:', data);
            return;
        }
        
        window.location.href = 'profile.html';
    } catch (error) {
        errorMessage.textContent = error.message;
        console.error('Login error:', error);
    }
});