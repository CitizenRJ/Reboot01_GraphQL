// Helper function to format XP values in kB
function formatXpLabel(xp) {
    return (xp / 1000).toFixed(1) + ' kB';
}

// Helper function to create SVG elements
function createSvgElement(type, attributes, parent) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', type);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'textContent') {
            element.textContent = value;
        } else {
            element.setAttribute(key, value);
        }
    }
    if (parent) {
        parent.appendChild(element);
    }
    return element;
}

// Add this function at the top
function showError(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div class="error-message" style="text-align:center; padding:20px;">
            <p>${message}</p>
            <button onclick="location.reload()">Retry</button>
        </div>
    `;
}

// Helper function for SVG graph initialization
function setupSvgGraph(svgId, title, data, emptyMessage = 'No data available') {
    const svg = document.getElementById(svgId);
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    
    // Clear existing content
    svg.innerHTML = '';
    
    // Check if there's data to display
    if (!data || (Array.isArray(data) && data.length === 0)) {
        createSvgElement('text', {
            x: width / 2,
            y: height / 2,
            'text-anchor': 'middle',
            'font-size': '16px',
            textContent: emptyMessage
        }, svg);
        return null;
    }
    
    // Add title
    createSvgElement('text', {
        x: width / 2,
        y: 30,
        'text-anchor': 'middle',
        'font-size': '16px',
        'font-weight': 'bold',
        textContent: title
    }, svg);
    
    return {
        svg,
        width,
        height
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    // Authentication check
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }
    
    // Logout function
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('userId');
        window.location.href = 'index.html';
    });
    
    // GraphQL query function
    async function fetchGraphQL(query, retries = 3, delay = 1000) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch('https://learn.reboot01.com/api/graphql-engine/v1/graphql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ query })
                });
                
                if (!response.ok) {
                    throw new Error(`GraphQL query failed: ${response.status}`);
                }
                
                return await response.json();
            } catch (error) {
                console.warn(`Attempt ${attempt+1}/${retries+1} failed:`, error.message);
                if (attempt === retries) throw error;
                
                // Wait before retrying (increasing delay with each retry)
                await new Promise(r => setTimeout(r, delay * (attempt + 1)));
            }
        }
    }

    async function fetchWithCache(queryName, query, userId, maxAge = 30 * 60 * 1000) {
        // Use passed userId instead of global user.id
        const cacheKey = `graphql_${queryName}_${userId}`;
        const cached = localStorage.getItem(cacheKey);
        
        if (cached) {
            try {
                const { data, timestamp } = JSON.parse(cached);
                // If cache is fresh, use it
                if (Date.now() - timestamp < maxAge) {
                    console.log(`Using cached data for ${queryName}`);
                    return { data };
                }
            } catch (e) {
                console.warn("Cache parse error:", e);
            }
        }
        
        // Otherwise fetch fresh data
        const result = await fetchGraphQL(query);
        if (result?.data) {
            localStorage.setItem(cacheKey, JSON.stringify({
                data: result.data,
                timestamp: Date.now()
            }));
        }
        return result;
    }
    
    try {
        // Move this to the VERY TOP of your function
        const user = JSON.parse(localStorage.getItem('user'));
        
        // Make sure we have a userId even if user object is invalid
        const userId = user?.id || localStorage.getItem('userId');
        if (!userId) {
            window.location.href = 'index.html'; // Redirect if no user
            return;
        }
        
        document.getElementById('user-info').innerHTML = `
            <div class="info-card">
                <p><strong>User ID:</strong> ${user.id}</p>
                <p><strong>Login:</strong> ${user.login}</p>
                <p><strong>Name:</strong> ${user.firstName || ''} ${user.lastName || ''}</p>
            </div>
        `;
        
        // 2. QUERY WITH ARGUMENTS - Get XP data for this user
        const xpQuery = `{
            transaction(
                where: {
                    type: {_eq: "xp"}, 
                    userId: {_eq: ${userId}}
                },
                order_by: {createdAt: asc}
            ) {
                id
                amount
                createdAt
                path
                objectId
            }
        }`;
        
        // Then use userId (not user.id) in your fetch calls
        const xpData = await fetchWithCache('xp', xpQuery, userId);
        if (!xpData || !xpData.data) throw new Error('Failed to fetch XP data');
        
        const transactions = xpData.data.transaction;
        
        // Calculate total XP
        const totalXP = transactions.reduce((sum, t) => sum + t.amount, 0);
        
        // Group XP by project path
        const xpByProject = transactions.reduce((acc, t) => {
            // Extract project name from path
            const pathParts = t.path.split('/');
            const projectName = pathParts[pathParts.length - 1];
            
            if (!acc[projectName]) {
                acc[projectName] = 0;
            }
            acc[projectName] += t.amount;
            return acc;
        }, {});
        
        // Display XP info
        let xpByProjectHTML = '';
        Object.entries(xpByProject)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .forEach(([project, amount]) => {
                xpByProjectHTML += `<p><strong>${project}:</strong> ${formatXpLabel(amount)}</p>`;
            });
        
        document.getElementById('xp-info').innerHTML = `
            <div class="info-card">
                <p><strong>Total XP:</strong> ${formatXpLabel(totalXP)}</p>
                <h4>Top Projects by XP:</h4>
                ${xpByProjectHTML}
            </div>
        `;
        
        // 3. NESTED QUERY – only fetch non‐null grades (i.e. completed attempts)
        const progressQuery = `{
            progress(
                where: {
                    userId: {_eq: ${userId}}
                },
                order_by: {updatedAt: desc}
            ) {
                id
                grade
                createdAt
                updatedAt
                path
                object {
                    id
                    name
                    type
                }
            }
        }`;
        const progressData = await fetchWithCache('progress', progressQuery, userId);
        if (!progressData?.data) throw new Error('Failed to fetch progress data');

        const progress = progressData.data.progress;

        // Dedupe to latest per object
        const latestByObj = progress.reduce((acc, p) => {
            const key = p.object.id;
            if (!acc[key] || new Date(p.updatedAt) > new Date(acc[key].updatedAt)) {
                acc[key] = p;
            }
            return acc;
        }, {});

        const uniqueProgress = Object.values(latestByObj);
        const inProgress = uniqueProgress.filter(p => p.grade === null).length;
        const passedProjects = uniqueProgress.filter(p => p.grade > 0).length;
        const failedProjects = uniqueProgress.filter(p => p.grade === 0).length;

        const totalDone    = passedProjects + failedProjects;
        const passRate     = totalDone ? Math.round(passedProjects/totalDone*100) : 0;

        // Update DOM with pass/fail stats
        function setElementContent(id, content) {
            const element = document.getElementById(id);
            if (element) element.textContent = content;
        }

        setElementContent('passed-count', passedProjects);
        setElementContent('failed-count', failedProjects);
        setElementContent('pass-rate', passRate + '%');

        // Populate recent projects list
        const recentContainer = document.getElementById('recent-projects');
        recentContainer.innerHTML = '';  // clear loader
        uniqueProgress
          .sort((a,b)=> new Date(b.updatedAt) - new Date(a.updatedAt))
          .slice(0,5)
          .forEach(p => {
            const div = document.createElement('div');
            div.className = 'project-item';
            
            // Handle null grades as "In Progress"
            const status = p.grade === null ? 'In Progress' : 
                          p.grade > 0 ? 'Passed' : 'Failed';
            const cls = p.grade === null ? 'status-progress' : 
                       p.grade > 0 ? 'status-passed' : 'status-failed';
            
            div.innerHTML = `
              <span>${p.path.split('/').pop()}</span>
              <span class="${cls}">${status}</span>`;
            recentContainer.appendChild(div);
          });

        // Lazy load charts AFTER the critical content is displayed
        setTimeout(() => {
            try {
                createXpProgressGraph(transactions);
                createProjectRatioGraph(passedProjects, failedProjects);
            } catch (err) {
                console.error("Chart rendering error:", err);
                // Display fallback message in chart containers
                document.getElementById('xp-time-graph').innerHTML = 
                    '<text x="50%" y="50%" text-anchor="middle">Charts unavailable. Please reload.</text>';
                document.getElementById('project-ratio-graph').innerHTML = 
                    '<text x="50%" y="50%" text-anchor="middle">Charts unavailable. Please reload.</text>';
            }
        }, 100); // Small delay after main content loads

        document.getElementById('refresh-btn')?.addEventListener('click', () => {
            // Clear specific cache items
            localStorage.removeItem(`graphql_xp_${userId}`);
            location.reload();
        });
        
    } catch (error) {
        console.error('Error:', error);
        showError('user-info', 'Network error. Unable to load profile data.');
        showError('xp-info', 'Network error. Unable to load XP data.');  
        showError('projects-info', 'Network error. Unable to load project data.');
        showError('statistics-section', 'Network error. Unable to load statistics.');
    }
});

// SVG Graph 1: XP Progression Over Time
function createXpProgressGraph(transactions) {
    // Use the existing utility function
    const setup = setupSvgGraph(
        'xp-time-graph',
        '',  // Empty title since it's in HTML
        transactions?.length > 0 ? transactions : null,
        'No XP data available'
    );
    
    if (!setup) return;
    const { svg, width, height } = setup;
    
    // Continue with the rest of the function...
}

// SVG Graph 2: Project Pass/Fail Distribution
function createProjectRatioGraph(passed, failed) {
    const total = passed + failed;
    
    // Initialize SVG WITHOUT title (since it's already in HTML)
    const setup = setupSvgGraph(
        'project-ratio-graph',
        '',  // Empty string to skip title
        total > 0 ? { passed, failed } : null,
        'No project data available'
    );
    
    if (!setup) return;
    
    const { svg, width, height } = setup;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 40;
    
    // Calculate angles for pie chart
    const passedPercent = passed / total;
    const failedPercent = failed / total;
    const passedAngle = passedPercent * 360;
    
    // Colors
    const passedColor = '#2ecc71';
    const failedColor = '#e74c3c';
    
    // Create donut chart
    const donutWidth = radius * 0.4;
    
    // Inner circle
    createSvgElement('circle', {
        cx: centerX,
        cy: centerY,
        r: radius - donutWidth,
        fill: '#f5f5f5'
    }, svg);
    
    // Function to calculate SVG arc path
    function getArcPath(startAngle, endAngle, isLargeArc) {
        const startRad = (startAngle - 90) * Math.PI / 180;
        const endRad = (endAngle - 90) * Math.PI / 180;
        
        const x1 = centerX + radius * Math.cos(startRad);
        const y1 = centerY + radius * Math.sin(startRad);
        const x2 = centerX + radius * Math.cos(endRad);
        const y2 = centerY + radius * Math.sin(endRad);
        
        const x3 = centerX + (radius - donutWidth) * Math.cos(endRad);
        const y3 = centerY + (radius - donutWidth) * Math.sin(endRad);
        const x4 = centerX + (radius - donutWidth) * Math.cos(startRad);
        const y4 = centerY + (radius - donutWidth) * Math.sin(startRad);
        
        return `M ${x1} ${y1} A ${radius} ${radius} 0 ${isLargeArc} 1 ${x2} ${y2} 
                L ${x3} ${y3} A ${radius - donutWidth} ${radius - donutWidth} 0 ${isLargeArc} 0 ${x4} ${y4} Z`;
    }
    
    // Passed segment
    if (passed > 0) {
        createSvgElement('path', {
            d: getArcPath(0, passedAngle, passedAngle > 180 ? 1 : 0),
            fill: passedColor
        }, svg);
    }
    
    // Failed segment
    if (failed > 0) {
        createSvgElement('path', {
            d: getArcPath(passedAngle, 360, (360 - passedAngle) > 180 ? 1 : 0),
            fill: failedColor
        }, svg);
    }
    
    // Calculate label positions
    function calculateLabelPosition(centerX, centerY, radius, angleDegrees) {
        const angleRad = (angleDegrees - 90) * Math.PI / 180;
        return {
            x: centerX + radius * Math.cos(angleRad),
            y: centerY + radius * Math.sin(angleRad)
        };
    }

    const passedLabelPos = calculateLabelPosition(
        centerX, centerY, radius - donutWidth / 2, passedAngle / 2
    );

    const failedLabelAngle = (passedAngle + (360 - passedAngle) / 2) - 90;
    const failedLabelRad = failedLabelAngle * Math.PI / 180;
    const failedLabelX = centerX + (radius - donutWidth / 2) * Math.cos(failedLabelRad);
    const failedLabelY = centerY + (radius - donutWidth / 2) * Math.sin(failedLabelRad);
    
    // Add data labels directly on segments
    if (passedPercent > 0.05) {  // Lower threshold to make label more likely to appear
        createSvgElement('text', {
            x: passedLabelPos.x,
            y: passedLabelPos.y,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '14px',
            'font-weight': 'bold',
            'fill': 'black',  // Changed from white to black
            textContent: `${Math.round(passedPercent * 100)}% pass`  // Added "pass"
        }, svg);
    }
    
    // For larger segments (>20%), place label inside
    if (failedPercent >= 0.20) {
        createSvgElement('text', {
            x: failedLabelX,
            y: failedLabelY,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '14px',
            'font-weight': 'bold',
            'fill': 'black',
            textContent: `${Math.round(failedPercent * 100)}% fail`
        }, svg);
    }
    // For smaller segments (<20%), place label outside with connector
    else if (failedPercent > 0) {
        // Calculate position outside the segment
        const outsideLabelAngle = failedLabelAngle;
        const outsideLabelRad = outsideLabelAngle * Math.PI / 180;
        const outsideLabelX = centerX + (radius + 25) * Math.cos(outsideLabelRad);
        const outsideLabelY = centerY + (radius + 25) * Math.sin(outsideLabelRad);
        
        // Add connector line
        createSvgElement('line', {
            x1: centerX + radius * Math.cos(outsideLabelRad) * 0.8,
            y1: centerY + radius * Math.sin(outsideLabelRad) * 0.8,
            x2: outsideLabelX - 5 * Math.cos(outsideLabelRad),
            y2: outsideLabelY - 5 * Math.sin(outsideLabelRad),
            stroke: '#777',
            'stroke-width': '1'
        }, svg);
        
        // Add outside label
        createSvgElement('text', {
            x: outsideLabelX,
            y: outsideLabelY,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '14px',
            'font-weight': 'bold',
            textContent: `${Math.round(failedPercent * 100)}% fail`
        }, svg);
    }
}